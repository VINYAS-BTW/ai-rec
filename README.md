# AiREC Platform

AiREC is a multi-service recommendation platform.

## What it does

- User auth (signup/login/JWT)
- Model training and recommendation serving
- Webhook and API-key integration for external apps
- Kafka event pipeline
- Redis caching in recommendation proxy
- Agent service for orchestration workflows

## System components

| Service | Port | Responsibility |
|---|---:|---|
| Frontend (`frontend/s`) | 5173 | Dashboard UI |
| Auth (`backend/auth`) | 8080 | Signup, login, JWT, OAuth callbacks |
| ML Backend (`backend/back2`) | 8000 | Project lifecycle, training, inference |
| Webhooks (`backend/webhooks_services`) | 3001 | API-key apps, recommend proxy, usage tracking |
| Webhooks Consumer | n/a | Kafka consumer and stream persistence |
| Agent Service (`backend/agent_service`) | 8002 | Optional agent APIs |
| PostgreSQL | 5432 | Main database |
| Kafka | 9092 | Event stream |
| Redis | 6379 | Cache |

## Repository structure (expanded)

```text
ai-rec/
├── backend/
│   ├── auth/
│   │   ├── controllers/          # Auth handlers (signup/login/OAuth callback)
│   │   ├── db/                   # DB connection + schema bootstrap
│   │   ├── middlewares/          # Auth request validation middleware
│   │   ├── models/               # User model/data-access logic
│   │   ├── routes/               # /auth routes
│   │   ├── index.js              # Auth service entry point
│   │   └── package.json
│   │
│   ├── back2/
│   │   ├── saas_api.py           # Main FastAPI app
│   │   ├── dynamic_recommender.py# Unified model wrapper
│   │   ├── Content.py            # Content-based logic
│   │   ├── Collaborative.py      # Collaborative filtering logic
│   │   ├── Hybrid.py             # Hybrid recommendation logic
│   │   ├── models.py             # SQLAlchemy models
│   │   ├── requirements.txt
│   │   ├── user_uploads/         # Uploaded datasets
│   │   └── project_models/       # Trained model artifacts
│   │
│   ├── webhooks_services/
│   │   ├── controllers/          # apps/webhooks handlers
│   │   ├── routes/               # apps/recommend/webhooks/events routes
│   │   ├── workers/              # Kafka consumer realtime processor
│   │   ├── kafka/                # Kafka producer integration
│   │   ├── db/                   # Drizzle schema + db client
│   │   ├── utils/                # cache + shared helpers
│   │   ├── server.js             # Webhooks service entry point
│   │   └── package.json
│   │
│   └── agent_service/
│       ├── main.py               # Agent service entry point
│       └── requirements.txt
│
├── frontend/s/
│   ├── src/
│   │   ├── pages/                # Login, Signup, Dashboard, SuperAgent, Domain pages
│   │   ├── components/           # Shared UI blocks
│   │   ├── api.js                # Frontend API client wiring
│   │   └── App.jsx
│   ├── Dockerfile
│   └── package.json
│
├── external_client/
│   ├── MovieRec/                 # External demo app (API-key usage)
│   └── MusicRec/                 # External demo app (API-key usage)
│
├── scripts/
│   ├── init-neon-schemas.mjs     # One-time schema bootstrap
│   └── test-db-connection.mjs    # DB connectivity check
│
├── ARCHITECTURE.md               # Full architecture document
├── KAFKA_SETUP.md                # Kafka setup and run notes
├── TEAM_SETUP.md                 # Team onboarding setup
├── PENDING_WORK.md               # Delivery status tracker
├── docker-compose.yml            # Local multi-service orchestration
└── README.md
```

## Runtime flow (simple)

1. User logs in from frontend to auth service.
2. Frontend calls ML backend with JWT.
3. User creates project and trains model.
4. External app registers in webhooks and gets API key.
5. External app calls `/api/recommend`.
6. Webhooks validates key, checks cache, calls ML backend, returns results.
7. Events are emitted to Kafka and consumed by the webhooks consumer.

## Main APIs

### Auth

- `POST /auth/signup`
- `POST /auth/login`
- `GET /auth/google`
- `GET /auth/google/callback`

### ML backend

- `POST /create-project/`
- `GET /projects/`
- `GET /project/{id}/status`
- `GET /project/{id}/recommendations`

### Webhooks

- `POST /api/apps/register`
- `GET /api/apps`
- `GET /api/apps/usage`
- `POST /api/recommend`
- `POST /api/webhooks/register`
- `POST /api/webhooks/trigger`
- `GET /api/webhooks/metrics`

## Security and reliability

- bcrypt password hashing
- JWT auth
- API-key validation
- Zod request validation
- Route-level rate limiting
- Redis caching
- CORS allowlist

## Local run

```bash
docker compose up --build
```

Default endpoints:

- Frontend: `http://localhost:5173`
- Auth: `http://localhost:8080`
- ML backend: `http://localhost:8000`
- Webhooks: `http://localhost:3001`
- Agent service: `http://localhost:8002`

## Environment files

### `backend/auth/.env`

```env
PORT=8080
DATABASE_URL=postgresql://user:pass@host:5432/dbname
JWT_SECRET=replace-with-secure-value
```

### `backend/back2/.env`

```env
DATABASE_URL=postgresql://user:pass@host:5432/dbname
MLFLOW_TRACKING_URI=postgresql://user:pass@host:5432/dbname
JWT_SECRET=replace-with-secure-value
BACK2_INTERNAL_KEY=shared-internal-key
KAFKA_BROKERS=localhost:9092
EVENT_LOGGING_ENABLED=true
```

### `backend/webhooks_services/.env`

```env
PORT=3001
DATABASE_URL=postgresql://user:pass@host:5432/dbname
REDIS_URL=redis://localhost:6379
BACK2_INTERNAL_KEY=shared-internal-key
KAFKA_BROKERS=localhost:9092
EVENT_LOGGING_ENABLED=true
```

### optional `frontend/s/.env`

```env
VITE_AUTH_API_URL=http://localhost:8080
VITE_ML_API_URL=http://localhost:8000
VITE_WEBHOOK_API_URL=http://localhost:3001
```

## References

- `ARCHITECTURE.md`
- `KAFKA_SETUP.md`
- `TEAM_SETUP.md`
