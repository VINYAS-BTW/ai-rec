# AiREC-BaaS

A full-stack **recommendation platform (backend-as-a-service)** with ML models (parameter-driven, content-based, collaborative, hybrid), webhook notifications, auth, and an **agent layer** (domain agents + SuperAgent chat orchestration). **Dataset-agnostic:** upload any CSV from any domain, choose what to recommend and which columns to use; the system works the same for cars, products, movies, or any other tabular data. Train models, register apps with API keys, and get recommendations via the web UI or REST API.

**System design:** See **[ARCHITECTURE.md](ARCHITECTURE.md)** for flows, services, database schemas, and data flow.

## 📚 Quick Start

- **👥 Team setup?** → [TEAM_SETUP.md](TEAM_SETUP.md)
- **📊 Kafka?** → [KAFKA_SETUP.md](KAFKA_SETUP.md)

---

## Prerequisites
- **React.js**
- **Node.js** (v18+)
- **Python** (3.9+)
- **PostgreSQL** (local or [Neon](https://neon.tech))
- **Docker** (for Apache Kafka message broker; [download](https://www.docker.com/products/docker-desktop))

## Docker Quick Start

The repo now includes a root [docker-compose.yml](docker-compose.yml) that starts Postgres, Kafka, auth, the FastAPI ML backend, the webhook service, the webhook consumer, the optional agent service, and the frontend.

```bash
docker compose up --build
```

Then open:

- Frontend: http://localhost:5173
- Auth: http://localhost:8080
- ML backend: http://localhost:8000
- Webhooks: http://localhost:3001
- Agent service: http://localhost:8002

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
├── external_client/       # Static demo pages (MovieRec, MusicRec)
├── xternal_client/        # Legacy copies of the same demos (optional)
├── scripts/               # One-time DB schema setup (Neon)
├── docs/                  # Design PDFs (optional; not required to run the app)
├── PENDING_WORK.md        # Roadmap / future platform work
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

Optional paths (same `.env` file when needed):

- **`USER_UPLOADS_DIR`** — override where uploaded CSVs are stored (default: `backend/back2/user_uploads`).
- **`USER_UPLOADS_FALLBACK_DIRS`** — comma-separated extra directories to resolve stale absolute paths from shared DBs.
- **`WEBHOOK_SERVICE_URL`** — defaults to `http://localhost:3001` for `model_ready` notifications from back2.

### 3. Webhooks service (`backend/webhooks_services/.env`)

```env
PORT=3001
DATABASE_URL=postgresql://user:pass@host:5432/dbname
BACK2_INTERNAL_KEY=your-internal-key-for-webhook-service
KAFKA_BROKERS=localhost:9092
EVENT_LOGGING_ENABLED=true
```

**`BACK2_INTERNAL_KEY`** must match the value in `backend/back2/.env` so the webhook service can call the ML backend for recommendations. Optional: `FASTAPI_URL=http://localhost:8000` if the ML backend is on another host.

### 4. Kafka event broker (`backend/back2/.env` and `backend/webhooks_services/.env`)

Both services need Kafka configuration:

```env
KAFKA_BROKERS=localhost:9092
EVENT_LOGGING_ENABLED=true
```

- **`KAFKA_BROKERS`:** Comma-separated list of Kafka broker addresses. Default: `localhost:9092` (local Docker).
- **`EVENT_LOGGING_ENABLED`:** Set to `true` to emit training completion events to Kafka. Default: `true`.

### 5. Frontend (optional)

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

## Kafka setup (Docker)

### Start Kafka broker locally

**Windows, Mac, or Linux with Docker:**

```bash
docker run -d \
  --name kafka-broker \
  -p 9092:9092 \
  -e KAFKA_NODE_ID=1 \
  -e KAFKA_BROKER_ID=1 \
  -e KAFKA_PROCESS_ROLES=broker,controller \
  -e KAFKA_OFFSETS_TOPIC_REPLICATION_FACTOR=1 \
  -e KAFKA_CONTROLLER_QUORUM_VOTERS=1@localhost:29093 \
  -e KAFKA_LISTENERS=PLAINTEXT://0.0.0.0:29092,CONTROLLER://0.0.0.0:29093,PLAINTEXT_HOST://0.0.0.0:9092 \
  -e KAFKA_INTER_BROKER_LISTENER_NAME=PLAINTEXT \
  -e KAFKA_CONTROLLER_LISTENER_NAMES=CONTROLLER \
  -e KAFKA_ADVERTISED_LISTENERS=PLAINTEXT://kafka-broker:29092,PLAINTEXT_HOST://127.0.0.1:9092 \
  apache/kafka:4.2.0
```

Or use **Docker Compose** (create `docker-compose.yml` in project root):

```yaml
version: '3.9'
services:
  kafka:
    image: apache/kafka:4.2.0
    container_name: kafka-broker
    ports:
      - "9092:9092"
    environment:
      KAFKA_NODE_ID: 1
      KAFKA_BROKER_ID: 1
      KAFKA_PROCESS_ROLES: broker,controller
      KAFKA_OFFSETS_TOPIC_REPLICATION_FACTOR: 1
      KAFKA_CONTROLLER_QUORUM_VOTERS: 1@localhost:29093
      KAFKA_LISTENERS: PLAINTEXT://0.0.0.0:29092,CONTROLLER://0.0.0.0:29093,PLAINTEXT_HOST://0.0.0.0:9092
      KAFKA_INTER_BROKER_LISTENER_NAME: PLAINTEXT
      KAFKA_CONTROLLER_LISTENER_NAMES: CONTROLLER
      KAFKA_ADVERTISED_LISTENERS: PLAINTEXT://kafka-broker:29092,PLAINTEXT_HOST://127.0.0.1:9092
```

Then start with:

```bash
docker-compose up -d kafka
```

Verify Kafka is running:

```bash
docker ps | grep kafka
```

You should see the `kafka-broker` container running on port `9092`.

---

## Run the app (7 terminals + optional)

### Terminal 0 – Kafka (Docker)

```bash
docker run -d --name kafka-broker -p 9092:9092 \
  -e KAFKA_NODE_ID=1 -e KAFKA_BROKER_ID=1 \
  -e KAFKA_PROCESS_ROLES=broker,controller \
  -e KAFKA_OFFSETS_TOPIC_REPLICATION_FACTOR=1 \
  -e KAFKA_CONTROLLER_QUORUM_VOTERS=1@localhost:29093 \
  -e KAFKA_LISTENERS=PLAINTEXT://0.0.0.0:29092,CONTROLLER://0.0.0.0:29093,PLAINTEXT_HOST://0.0.0.0:9092 \
  -e KAFKA_INTER_BROKER_LISTENER_NAME=PLAINTEXT \
  -e KAFKA_CONTROLLER_LISTENER_NAMES=CONTROLLER \
  -e KAFKA_ADVERTISED_LISTENERS=PLAINTEXT://kafka-broker:29092,PLAINTEXT_HOST://127.0.0.1:9092 \
  apache/kafka:4.2.0
```

→ **Kafka broker on localhost:9092** (topics auto-created on first event emission).

**Stop Kafka (when done):**

docker stop kafka-broker && docker rm kafka-broker
```

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
python -m uvicorn saas_api:app --reload --reload-exclude "project_models"
```

→ **http://localhost:8000**

**Important (development):** use `--reload-exclude "project_models"` (or run `.\run-dev.ps1` from `backend/back2`). During training, MLflow writes copied Python files under `project_models/.../code/`; if the reloader watches that folder, **uvicorn restarts in the middle of training** and the project can stay stuck in `processing` or fail unpredictably.


### Terminal 3 – Webhooks & app registration
### Terminal 3b – Kafka event consumer (Node.js, same folder as Terminal 3)

In another terminal, from the same folder:

```bash
cd backend/webhooks_services
npm run start:consumer
```

This subscribes to `rec.events.v1` and persists events to PostgreSQL. Output should show:
```
[consumer] Consumer has joined the group
```

When training completes, you'll see:
```
[consumer] Event received: {...}
```

### Terminal 4 – Frontend (or 5 if using consumer)

```bash
cd frontend/s
npm install
npm run dev
```

→ **http://localhost:5173**

### Terminal 5 (or 6) – Agent service (optional but recommended for full agent architecture)

```bash
cd backend/agent_service
pip install -r requirements.txt
uvicorn main:app --reload --port 8002
```

→ **http://localhost:8002**

### Terminal 6 (or 7) – MLflow UI (optional)

```bash
cd backend/back2
mlflow ui --backend-store-uri $env:MLFLOW_TRACKING_URI --default-artifact-root ./mlflow_artifacts
```

(Windows CMD: `set MLFLOW_TRACKING_URI=...` then the same command.) → **http://localhost:5000**

### Optional – standalone agent service (`backend/agent_service`)

Only if you want the same domain/orchestrate HTTP API on a separate port (the main app already exposes `/agent/v1/*` on back2):

```bash
cd backend/agent_service
pip install -r requirements.txt
python -m uvicorn main:app --reload --port 8002
```

→ **http://localhost:8002**

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
7. **SuperAgent page:** Chat-style recommendation orchestration using `POST /superagent/v1/chat` with session memory, constraint parsing (`key=value` and space-separated pairs), and column names normalised to your CSV.

---

## ML API extras (vector + feature store)

After a project reaches **ready**, back2 builds a small **FAISS** index under `project_models/project_<id>/vector_index/` and materialises **Postgres** feature rows (`recommender.item_features` / `user_features`). Typical checks (with user JWT):

- `GET /project/<id>/vector-store/status`
- `GET /project/<id>/vector-store/similar-items?item_id=...&n=10`
- `GET /project/<id>/feature-store/items?limit=50`

Requires **faiss-cpu** from `backend/back2/requirements.txt` (on some ARM Macs you may need a platform-specific FAISS build).

---

## Implemented now (current state)

- **Core recommendation engine:** parameter-driven, content-based, collaborative, and hybrid training + inference.
- **Project lifecycle APIs:** create project, retrain, status, list, delete, context options, and recommendation retrieval.
- **Agent endpoints in `back2`:** domain recommend, orchestrate across domains, preset listing, context options, and preset/upload training flows.
- **SuperAgent MVP in `back2`:** intent/domain inference from text, key/value context extraction, session-sticky constraints, column normalisation against the trained project, top-k inference, and clarify-first chat when domain or constraints are missing.
- **Vector + feature store (MVP):** per-project FAISS similarity index and Postgres-backed feature bags, populated at end of training; HTTP endpoints for status, similar items/users, and feature listing/upsert.
- **Webhook gateway:** app registration, API key validation, recommendation proxying, usage tracking, and async webhook pushes.
- **Frontend modules:** Recommender Studio, Domain Agents, SuperAgent chat, and Webhook Dashboard.
- **Auth:** email/password + Google OAuth routes with JWT verification on protected recommendation endpoints.

---

## External demo clients

- **MovieRec / MusicRec:** Use `external_client/MovieRec` or `external_client/MusicRec` (same idea as `xternal_client/`). In each `app.js` set `API_KEY` from the Webhook Dashboard and `PROJECT` to an existing project ID (`GET http://localhost:8000/projects/` with your JWT).
- Static server example: `npx serve external_client/MovieRec`

---

## Port summary

| Service | Port | Purpose |
|---------|------|---------|
| Kafka broker | 9092 | Event streaming (Docker) |
| Auth | 8080 | Login, signup, JWT |
| ML recommender | 8000 | Projects, train, recommend, emit events |
| Agent service | 8002 | Optional agent layer API |
| Webhooks | 3001 | Apps, API key, recommend, consume events |
| Frontend | 5173 | React UI |
| MLflow UI | 5000 | Optional model registry |

---

## Troubleshooting

- **Training never finishes / stuck on “processing” (Recommender Studio or agent train):** Restart the ML API with `--reload-exclude "project_models"` (see Terminal 2 above). Without it, auto-reload can kill the training task when files appear under `backend/back2/project_models/`.
- **`GET /agent/v1/context-options` returns 404:** There is no READY trained project for that domain for your user yet. Train a logistics/supply-chain preset from the Domain Agents tab (or upload matching data) until status is ready, then context options will load.
- **`GET /projects/` returns 401:** Log in again; the frontend token expired or `JWT_SECRET` mismatches between auth and back2.
- **CORS / connection errors:** Ensure Auth (8080), back2 (8000), and webhooks (3001) are running before using the frontend.
- **Kafka connection failed:** Ensure Kafka Docker is running on port 9092. Check `docker ps` and, if needed, start the stack with `docker compose up kafka`.
- **Events not persisted to database:** Verify Kafka is running, check the backend logs for `Emitted Kafka event for training completion`, check consumer logs for `[consumer] Consumer has joined the group`, and query `webhooks.event_logs` for the event.
- **Consumer won't start:** Ensure `KAFKA_BROKERS` is set to `kafka:29092` inside the Docker stack, or `localhost:9092` when running locally.
- **Project not found:** The `project_id` must exist in the ML backend. Create a project in the Dashboard, wait until status is Ready, then use that ID.
- **Project not found or not ready:** Wait until the project status is Ready after uploading data and training.
- **Database errors:** Run the schema script (see [One-time database setup](#one-time-database-setup-neon-or-single-postgresql)) and check `DATABASE_URL` (and `MLFLOW_TRACKING_URI` for back2) in each `.env`.
- **Content model error ("not in index" / empty column):** Ensure the content file has `item_id`, `item_title`, and at least one feature column mapped to real CSV columns.
- **SuperAgent always returns the same list:** Use exact feature column names from your CSV (`mode=road`, not free text). Put several pairs on one line or comma-separated; the same session remembers prior constraints.
