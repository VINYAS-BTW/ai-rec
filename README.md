# AiREC-BaaS

A full-stack **recommendation platform (backend-as-a-service)** with ML models (parameter-driven, content-based, collaborative, hybrid), webhook notifications, auth, and an **agent layer** (domain agents + SuperAgent chat orchestration). **Dataset-agnostic:** upload any CSV from any domain, choose what to recommend and which columns to use; the system works the same for cars, products, movies, or any other tabular data. Train models, register apps with API keys, and get recommendations via the web UI or REST API.

**System design:** See **[ARCHITECTURE.md](ARCHITECTURE.md)** for flows, services, database schemas, and data flow.

---

## Prerequisites
- **React.js**
- **Node.js** (v18+)
- **Python** (3.9+)
- **PostgreSQL** (local or [Neon](https://neon.tech))

---

## Project structure

```
ai-rec/
├── backend/
│   ├── auth/              # Auth API (login, signup, JWT); Drizzle ORM
│   ├── back2/             # FastAPI ML recommender + MLflow; SQLAlchemy
│   ├── agent_service/     # Optional standalone agent layer (FastAPI)
│   ├── agent_datasets/    # Preset CSV templates for domain agents
│   └── webhooks_services/ # App registration + webhooks + recommend proxy; Drizzle ORM
├── frontend/s/            # React (Vite) dashboard
├── external_client/       # Demo clients
├── xternal_client/        # Legacy demo clients (MovieRec, MusicRec)
├── scripts/               # One-time DB schema setup (Neon)
└── example_datasets/      # Sample CSVs for movies/songs
```

---

## Environment setup

Each backend service needs a `.env` file. Use the same PostgreSQL instance (or Neon) and set the connection string per service.

### 1. Auth (`backend/auth/.env`)

```env
PORT=8080
DATABASE_URL=postgresql://user:pass@host:5432/dbname
JWT_SECRET=your-strong-secret-change-in-production
```

### 2. ML recommender (`backend/back2/.env`)

```env
DATABASE_URL=postgresql://user:pass@host:5432/dbname
MLFLOW_TRACKING_URI=postgresql://user:pass@host:5432/dbname
JWT_SECRET=your-strong-secret-change-in-production
BACK2_INTERNAL_KEY=your-internal-key-for-webhook-service
```

Use the same DB (or one with a `recommender` schema). Tables are created on startup. **`JWT_SECRET`** must match the auth service so the ML backend can verify JWTs and scope projects per user. **`BACK2_INTERNAL_KEY`** (optional): set the same value in the webhooks service so it can call the ML backend for recommendations without a user JWT.

### 3. Webhooks service (`backend/webhooks_services/.env`)

```env
PORT=3001
DATABASE_URL=postgresql://user:pass@host:5432/dbname
BACK2_INTERNAL_KEY=your-internal-key-for-webhook-service
```

**`BACK2_INTERNAL_KEY`** must match the value in `backend/back2/.env` so the webhook service can call the ML backend for recommendations. Optional: `FASTAPI_URL=http://localhost:8000` if the ML backend is on another host.

### 4. Frontend (optional)

Create `frontend/s/.env` if auth runs on a different URL:

```env
VITE_AUTH_API_URL=http://localhost:8080
```

Defaults in code: Auth `http://localhost:8080`, ML `http://localhost:8000`, Webhooks `http://localhost:3001`.

### Neon connection checklist (if you get "could not translate host name" / ENOTFOUND)

- **`.env` location:** Each service loads `.env` from its own folder. Ensure:
  - `backend/back2/.env` for the ML API
  - `backend/auth/.env` for auth
  - `backend/webhooks_services/.env` for webhooks  
  You can start the server from any directory; the correct `.env` is used.
- **URL format:** One line, no line breaks; avoid trailing spaces or Windows CRLF (the app trims the value; if problems persist, save `.env` with LF line endings). If the password has special characters, URL-encode them or wrap the value in quotes in `.env`.
- **Test connection:** From a backend folder (e.g. `backend/auth`), run `node ../../scripts/test-db-connection.mjs` to verify `DATABASE_URL` is loaded and see the exact error (masked URL and ENOTFOUND hint).
- **Neon dashboard:** Copy the connection string from the Neon project (Connection string). Prefer the **pooler** (e.g. `*-pooler.*.neon.tech`) for serverless; if your network blocks it, try the **direct** connection string.
- **DNS/network:** From the same machine where the app runs, check that the host resolves:  
  `ping ep-xxxx-pooler.region.aws.neon.tech` (use your actual host from the URL). If this fails, the issue is network/DNS/firewall (e.g. corporate VPN, different DNS).

---

## One-time database setup (Neon or single PostgreSQL)

Use one database with separate schemas: `auth`, `webhooks`, `recommender`.

### Neon

1. Go to [console.neon.tech](https://console.neon.tech) → create or open a project → **Connection details**.
2. Copy the connection string (keep `?sslmode=require`).
3. Run the schema script once (from project root):

**Windows (PowerShell):**

```powershell
cd backend\webhooks_services
npm install
$env:DATABASE_URL="postgresql://user:pass@host/db?sslmode=require"
node ..\..\scripts\init-neon-schemas.mjs
```

**Mac/Linux:**

```bash
cd backend/webhooks_services
npm install
DATABASE_URL="postgresql://user:pass@host/db?sslmode=require" node ../../scripts/init-neon-schemas.mjs
```

You should see: `✅ Schemas created: auth, webhooks, recommender`.

Then set the **same** connection string in `backend/auth/.env`, `backend/webhooks_services/.env`, and `backend/back2/.env` (and `MLFLOW_TRACKING_URI` for back2).

### Local PostgreSQL

Create the schemas manually or run the same script with your local `DATABASE_URL`. Tables are created on app startup (Auth and Webhooks use Drizzle bootstrap; back2 uses Alembic/SQLAlchemy).

### Database & ORM

- **Auth** and **Webhooks**: Drizzle ORM (`db/schema.js`, `db/index.js`). Optional: `npm run db:generate` / `npm run db:migrate` / `npm run db:studio` in each service.
- **back2**: SQLAlchemy ORM; `recommender` schema. No extra migration step needed for first run.

---

## Run the app (5 terminals + optional)

### Terminal 1 – Auth

```bash
cd backend/auth
npm install
npm start
```

→ **http://localhost:8080**  
Endpoints: `POST /auth/signup` (body: `{ name, email, password }`), `POST /auth/login` (body: `{ email, password }` → returns `jwttoken`, `name`, `email`).

### Terminal 2 – ML recommender (FastAPI)

```bash
cd backend/back2
pip install -r requirements.txt
uvicorn saas_api:app --reload
```

→ **http://localhost:8000**

### Terminal 3 – Webhooks & app registration

```bash
cd backend/webhooks_services
npm install
npm start
```

→ **http://localhost:3001**

### Terminal 4 – Frontend

```bash
cd frontend/s
npm install
npm run dev
```

→ **http://localhost:5173**

### Terminal 5 – Agent service (optional but recommended for full agent architecture)

```bash
cd backend/agent_service
pip install -r requirements.txt
uvicorn main:app --reload --port 8002
```

→ **http://localhost:8002**

### Terminal 6 (optional) – MLflow UI

```bash
cd backend/back2
mlflow ui --backend-store-uri $env:MLFLOW_TRACKING_URI --default-artifact-root ./mlflow_artifacts
```

(Windows CMD: `set MLFLOW_TRACKING_URI=...` then the same command.) → **http://localhost:5000**

---

## Using the application

1. Open **http://localhost:5173**.
2. **Sign up** or **log in** (auth on port 8080).
3. **Recommender Studio:** Create a project.  
   - **Single dataset (any CSV):** Choose “Single dataset – recommend any column by others”. Upload any CSV, set the **target** column (what to recommend) and **feature** columns (what to base recommendations on). Works for any domain.  
   - **Content + Interaction:** Upload content and/or interaction CSVs, map columns (item_id, item_title, features for content; user_id, item_id, rating for interactions). Model types: content / collaborative / hybrid.  
   Wait until status is **Ready**, then get recommendations (for single-dataset projects: set context from dropdowns; for content/collab/hybrid: by item title and/or user id). You can delete a project from the project list.
4. **Webhook Dashboard:** Register an app (name + webhook URL). Copy the **API key** for the external client or API calls.
5. **Recommendations API** (with API key):  
   `POST http://localhost:3001/api/recommend`  
   Headers: `Content-Type: application/json`, `x-api-key: YOUR_API_KEY`  
   Body: `{ "project_id": 1, "item_title": "Some Movie", "user_id": "123" }` (omit `user_id` for content-only; omit `item_title` for collaborative-only).
6. **Domain Agents page:** Train and query domain presets (logistics/supply-chain) from the frontend using `/agent/v1/*` endpoints in `back2`.
7. **SuperAgent page:** Chat-style recommendation orchestration using `POST /superagent/v1/chat` with session memory and clarification prompts.

---

## Implemented now (current state)

- **Core recommendation engine:** parameter-driven, content-based, collaborative, and hybrid training + inference.
- **Project lifecycle APIs:** create project, retrain, status, list, delete, context options, and recommendation retrieval.
- **Agent endpoints in `back2`:** domain recommend, orchestrate across domains, preset listing, context options, and preset/upload training flows.
- **SuperAgent MVP in `back2`:** intent/domain inference from text, key/value context extraction, top-k inference, session memory, and clarify-first chat responses.
- **Webhook gateway:** app registration, API key validation, recommendation proxying, usage tracking, and async webhook pushes.
- **Frontend modules:** Recommender Studio, Domain Agents, SuperAgent chat, and Webhook Dashboard.
- **Auth:** email/password + Google OAuth routes with JWT verification on protected recommendation endpoints.

---

## External demo clients

- **MovieRec:** Open `xternal_client/MovieRec/index.html`. In `app.js` set `API_KEY` (from Webhook Dashboard) and `PROJECT` to an **existing** project ID (create one in the Dashboard first; list IDs: `GET http://localhost:8000/projects/`).
- **MusicRec:** Open `xternal_client/MusicRec/index.html`.  
To run with a static server: `npx serve xternal_client/MovieRec`.

---

## Port summary

| Service        | Port | Purpose                    |
|----------------|------|----------------------------|
| Auth           | 8080 | Login, signup, JWT         |
| ML recommender | 8000 | Projects, train, recommend |
| Agent service  | 8002 | Optional agent layer API   |
| Webhooks       | 3001 | Apps, API key, recommend   |
| Frontend       | 5173 | React UI                   |
| MLflow UI      | 5000 | Optional model registry    |

---

## Troubleshooting

- **CORS / connection errors:** Ensure Auth (8080), back2 (8000), and webhooks (3001) are running before using the frontend.
- **"Project not found" (404):** The `project_id` (e.g. in MovieRec’s `PROJECT` or in the recommend API) must exist in the ML backend. Create a project in the Dashboard, wait until status is **Ready**, then use that ID (or list IDs with `GET http://localhost:8000/projects/`).
- **"Project not found or not ready":** Wait until the project status is **Ready** after uploading data and training.
- **Database errors:** Run the schema script (see [One-time database setup](#one-time-database-setup-neon-or-single-postgresql)) and check `DATABASE_URL` (and `MLFLOW_TRACKING_URI` for back2) in each `.env`.
- **Content model error ("not in index" / empty column):** Ensure the content file has **item_id**, **item_title**, and at least one **feature** column mapped to real CSV columns (no empty mappings).
