# AiREC – System Architecture & Design

This document describes the end-to-end architecture, data flow, and design of the recommendation platform.

---

## 1. High-Level Architecture

```
┌───────────────────────────────────────────────────────────────────────────────┐
│                              CLIENTS                                          │
├──────────────────────────────────┬────────────────────────────────────────────┤
│  React Dashboard (Vite)          │  External clients (MovieRec, MusicRec, etc.)│
│  http://localhost:5173           │  Static HTML/JS, open index.html           │
│  • Login / Signup                │  • API key + project_id in app.js          │
│  • Recommender Studio            │  • POST /api/recommend                     │
│  • Webhook Dashboard             │                                            │
└──────────────┬───────────────────┴───────────────────────┬────────────────────┘
               │                                            │
               │ JWT (login)                                 │ x-api-key
               ▼                                            ▼
┌──────────────────────────────┐              ┌─────────────────────────────────────┐
│  Auth service (Node.js)      │              │  Webhooks service (Node.js)         │
│  http://localhost:8080       │              │  http://localhost:3001              │
│  • POST /signup, /login      │              │  • POST /api/apps/register          │
│  • JWT in response           │              │  • GET  /api/apps, /api/apps/usage  │
│  • Schema: auth              │              │  • POST /api/recommend              │
└──────────────┬───────────────┘              └──────────────┬──────────────────────┘
               │                                             │
               │ PostgreSQL                                   │ GET /project/{id}/recommendations
               ▼                                             ▼
┌──────────────────────────────────────────────────────────────────────────────────┐
│  PostgreSQL (single DB or Neon)                                                  │
│  Schemas: auth | webhooks | recommender                                          │
│  • auth: users (login/signup)                                                    │
│  • webhooks: apps (api_key, webhook_url), usage (app_name, usage_count)          │
│  • recommender: recommender_projects, uploaded_files, schema_mappings            │
└──────────────────────────────────────────────────────────────────────────────────┘
               ▲                                             │
               │                                             │
┌──────────────┴───────────────┐              ┌──────────────┴───────────────────────┐
│  ML Recommender (FastAPI)    │              │  MLflow (optional UI :5000)          │
│  http://localhost:8000       │◄────────────►│  Model registry (same DB or URI)     │
│  • POST /create-project/     │   register   │  • project-{id}-recommender          │
│  • GET  /projects/           │   & load     │  • pyfunc wrapper (Content/CF/Hybrid)│
│  • GET  /project/{id}/status │   models     │                                      │
│  • GET  /project/{id}/items  │              │                                      │
│  • GET  /project/{id}/users  │              │                                      │
│  • GET  /project/{id}/recommendations       │                                      │
└──────────────────────────────┘              └──────────────────────────────────────┘
```

---

## 2. Services & Ports

| Service           | Port | Stack      | Role |
|-------------------|------|------------|------|
| **Auth**          | 8080 | Node.js    | User signup, login, JWT. No auth required for ML/Webhooks from frontend in current design. |
| **ML Recommender**| 8000 | FastAPI    | Create project, upload CSVs, background training, MLflow registration, recommendations API. |
| **Webhooks**      | 3001 | Node.js    | Register external apps (name + webhook URL → API key), proxy recommend with API-key validation, optional webhook POST on recommend. |
| **Frontend**      | 5173 | React/Vite | Dashboard: auth, Recommender Studio, Webhook Dashboard. |
| **MLflow UI**     | 5000 | Optional   | Browse runs and registered models. |

---

## 3. Database Design (PostgreSQL)

One database is used with **three schemas** (created once via `scripts/init-neon-schemas.mjs`). **Auth** and **Webhooks** use Drizzle ORM; **back2** uses SQLAlchemy.

### 3.1 Schema: `auth`
- **users**: id, name, email, password (bcrypt), created_at. Used for login/signup and JWT.

### 3.2 Schema: `webhooks`
- **apps**: id, app_name, webhook_url, api_key, created_at. One row per registered external app.
- **usage**: app_name (PK), usage_count. Incremented when `/api/recommend` is called with a valid API key.

### 3.3 Schema: `recommender`
- **recommender_projects**: id, project_name, status (PENDING → PROCESSING → READY / ERROR), model_type (CONTENT | COLLABORATIVE | HYBRID), mlflow_model_name, mlflow_model_version, created_at.
- **uploaded_files**: id, project_id (FK → recommender_projects), file_type (CONTENT | INTERACTION), storage_path (local path to CSV), created_at.
- **schema_mappings**: id, file_id (FK → uploaded_files), app_schema_key (e.g. item_id, item_title, user_id, feature_col), user_csv_column (column name in CSV).

Files are stored on disk under `backend/back2/user_uploads/`. MLflow stores artifacts and model registry in DB or local path per `MLFLOW_TRACKING_URI`.

---

## 4. End-to-End Flows

### 4.1 Auth Flow (Dashboard user)

1. User opens frontend (e.g. http://localhost:5173).
2. **Signup**: `POST {API_AUTH}/signup` with name, email, password → Auth service hashes password, inserts into `auth.users`, returns success.
3. **Login**: `POST {API_AUTH}/login` with email, password → Auth checks `auth.users`, compares password, returns JWT (and name/email). Frontend stores JWT (e.g. localStorage) and sets it in `AuthContext`.
4. **Protected routes**: `ProtectedRoute` checks token; if missing/expired, redirects to `/login`. `RefreshHandler` can refresh token if you add a refresh endpoint.
5. Dashboard (`/app`) is only reachable when authenticated (no JWT sent to back2 or webhooks in current design; auth is frontend-only for protecting UI).

### 4.2 Recommender Studio Flow (Create project → Train → Recommend)

1. User is on Dashboard → **Recommender Studio** tab.
2. **List projects**: `GET {API_BACKEND}/projects/` → FastAPI reads `recommender.recommender_projects`, returns list.
3. **Create project**: User enters project name, uploads **content** and/or **interaction** CSV(s), maps CSV columns to app schema (item_id, item_title, user_id, feature_col, etc.). Frontend calls `POST {API_BACKEND}/create-project/` with `FormData` (project_name, content_file, content_schema_json, interaction_file, interaction_schema_json). FastAPI:
   - Inserts a row in `recommender_projects` (status PENDING, model_type derived from which files are present).
   - Saves files to disk and inserts `uploaded_files` + `schema_mappings`.
   - Schedules a **background task** `process_project(project_id)` and returns the new project (with id).
4. **Background training** (`process_project`):
   - Sets status to PROCESSING.
   - Loads CSVs and schemas, builds Content-based and/or Collaborative (and Hybrid) models (Content.py, Collaborative.py, Hybrid.py).
   - Wraps in `MLflowRecommenderWrapper` (dynamic_recommender.py), logs to MLflow, registers model as `project-{id}-recommender`.
   - Updates project: mlflow_model_name, mlflow_model_version, status = READY (or ERROR on failure).
   - Optionally notifies webhooks (e.g. “model_ready”) via Webhooks service.
5. **Poll status**: Frontend polls `GET {API_BACKEND}/project/{id}/status` until status is READY (or ERROR).
6. **Get items/users**: For dropdowns, frontend calls `GET .../project/{id}/items` and `GET .../project/{id}/users` (FastAPI reads from saved CSVs via schema_mappings).
7. **Get recommendations (from Dashboard)**: User selects project, item title and/or user id, clicks recommend. Frontend calls `GET {API_BACKEND}/project/{id}/recommendations?item_title=...&user_id=...`. FastAPI loads the registered MLflow model, runs inference, returns recommendations JSON.

### 4.3 Webhook / External Client Flow (API key + recommend)

1. **Register app**: From Dashboard **Webhook Dashboard** tab, user registers an app (name + webhook URL). Frontend calls `POST {API_WEBHOOK}/api/apps/register` with `{ app_name, webhook_url }`. Webhooks service generates an API key, inserts into `webhooks.apps`, returns api_key. User copies it into external client (e.g. MovieRec `app.js`).
2. **Recommend from external client**: MovieRec (or any client) sends `POST {API_WEBHOOK}/api/recommend` with header `x-api-key: <key>` and body `{ project_id, item_title, user_id }`. Webhooks service:
   - Validates API key against `webhooks.apps`.
   - Proxies to FastAPI: `GET http://localhost:8000/project/{project_id}/recommendations?item_title=...&user_id=...`.
   - On success: increments `webhooks.usage`, returns recommendations to client, and optionally POSTs the same payload to the app’s `webhook_url` (async).
   - On 404/4xx/5xx from FastAPI: returns error to client (e.g. “Project not found or not ready”).
3. **project_id** in the body must be an existing project id in `recommender.recommender_projects` with status READY (created via Dashboard Recommender Studio).

---

## 5. Recommendation API (FastAPI) – Details

- **Endpoint**: `GET /project/{project_id}/recommendations?item_title=...&user_id=...&n=10`
- **Logic**: Load project from DB; ensure status READY and mlflow_model_name set; load model via `mlflow.pyfunc.load_model(models:/project-{id}-recommender/version)`; build input DataFrame (user_id, item_title, n); call `model.predict()`; return JSON with recommendations and model_type.
- **Model types**:
  - **Content**: requires `item_title`.
  - **Collaborative**: requires `user_id`.
  - **Hybrid**: requires both `user_id` and `item_title`.

---

## 6. Security Notes

- **Auth**: Passwords hashed with bcrypt; JWT signed with `JWT_SECRET` (env). Frontend protects routes; back2 and webhooks do not validate JWT in the current design.
- **Webhooks**: Only API key is validated for `/api/recommend`; no per-project or per-user auth. Keep API keys and `.env` (DATABASE_URL, JWT_SECRET) out of version control.
- **CORS**: Enabled on Auth, Webhooks, and FastAPI so the frontend (and optionally external clients) can call them from the browser.

---

## 7. File / Directory Roles

| Path | Purpose |
|------|--------|
| `backend/auth/` | Auth API (signup, login, JWT), uses `auth` schema. |
| `backend/back2/` | FastAPI app (saas_api.py), DB (database.py), models (models.py), ML (Content.py, Collaborative.py, Hybrid.py, dynamic_recommender.py), MLflow. Uses `recommender` schema and local `user_uploads/`. |
| `backend/webhooks_services/` | Express app (server.js), routes (apps, recommend, webhooks), DB via Drizzle (`db/index.js`, `webhooks` schema). Proxies recommend to FastAPI. |
| `frontend/s/` | React app: auth context, login/signup, protected app shell, Dashboard (Recommender Studio + Webhook Dashboard). |
| `xternal_client/MovieRec/` | Demo client: hardcoded API_KEY and PROJECT in app.js; POSTs to Webhooks `/api/recommend`. |
| `scripts/init-neon-schemas.mjs` | One-time creation of schemas auth, webhooks, recommender. |

---


