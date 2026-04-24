# AiREC Platform

AiREC is a multi-service recommendation platform for building, training, and serving domain-agnostic recommendation systems. It supports content-based, collaborative, hybrid, and parameter-driven recommendation flows, plus API-key based integration for external applications.

The platform is designed for teams that need:

- Fast onboarding of new recommendation projects from CSV data
- Managed project lifecycle (create, train, monitor, infer, retrain)
- Secure dashboard access with JWT-based auth
- External consumption through webhook and API-key gateway patterns
- Event streaming infrastructure for real-time processing and analytics

For architectural diagrams and deeper design notes, see `ARCHITECTURE.md`.

## Core Capabilities

- User authentication with signup/login and JWT issuance
- Project-based recommendation model training and serving
- Flexible schema mapping for uploaded datasets
- Webhook app registration with generated API keys
- Recommendation proxy endpoint for external client consumption
- Kafka-backed event emission and consumer processing
- Redis-backed response caching in webhooks service
- Agent-oriented endpoints for orchestration and conversational workflows

## System Components

| Service | Port | Responsibility |
|---|---:|---|
| Frontend (`frontend/s`) | 5173 | Web dashboard for auth, project creation, recommendations, and webhook management |
| Auth (`backend/auth`) | 8080 | Signup, login, JWT token generation, OAuth callbacks |
| ML Backend (`backend/back2`) | 8000 | Project lifecycle, training pipelines, model loading, recommendation inference |
| Webhooks (`backend/webhooks_services`) | 3001 | App registration, API-key validation, recommendation proxy, usage tracking |
| Webhooks Consumer | n/a | Kafka consumer for event processing and persistence |
| Agent Service (`backend/agent_service`) | 8002 | Optional standalone agent APIs |
| PostgreSQL | 5432 | Persistent storage for auth, webhooks, and recommender schemas |
| Kafka | 9092 | Event streaming backbone |
| Redis | 6379 | Cache layer used by webhooks recommendation flow |

## Repository Structure

```text
ai-rec/
├── backend/
│   ├── auth/
│   ├── back2/
│   ├── webhooks_services/
│   └── agent_service/
├── frontend/s/
├── external_client/
├── scripts/
├── ARCHITECTURE.md
└── docker-compose.yml
```

## Runtime Architecture

1. A user authenticates via the Auth service.
2. The frontend uses the JWT to call protected ML endpoints.
3. The user creates a recommendation project and uploads datasets.
4. The ML backend trains and registers project-specific model artifacts.
5. External apps register in Webhooks service and receive API keys.
6. External apps request recommendations through `/api/recommend`.
7. Webhooks service validates API key, optionally serves cache, calls ML backend, tracks usage, emits events, and pushes outbound webhook payloads.

## User Workflow (End-to-End)

### 1) Access and Authentication

1. Open the dashboard (`http://localhost:5173`).
2. Create an account or log in.
3. Receive JWT session for protected operations.

### 2) Project Creation and Training

1. Navigate to Recommender Studio.
2. Create a project with one or more datasets.
3. Map uploaded columns to required schema keys.
4. Submit project for training.
5. Poll project status until it reaches `READY`.

### 3) Recommendation Retrieval (Internal Dashboard)

1. Choose a trained project.
2. Provide context (`item_title`, `user_id`, or both based on model type).
3. Request recommendations from ML backend.
4. Render ranked response list in the UI.

### 4) External App Integration

1. Register external app in Webhooks dashboard (`app_name`, `webhook_url`).
2. Receive generated API key.
3. Call `POST /api/recommend` on webhooks service with `x-api-key`.
4. Receive recommendations response.
5. Optional webhook callback receives recommendation payload asynchronously.

## API Overview

### Auth Service (`/auth`)

- `POST /auth/signup`
- `POST /auth/login`
- `GET /auth/google`
- `GET /auth/google/callback`

### ML Backend (selected)

- `POST /create-project/`
- `GET /projects/`
- `GET /project/{id}/status`
- `GET /project/{id}/recommendations`

### Webhooks Service

- `POST /api/apps/register`
- `GET /api/apps`
- `GET /api/apps/usage`
- `POST /api/recommend`
- `POST /api/webhooks/register`
- `POST /api/webhooks/trigger`
- `GET /api/webhooks/metrics`

## Security and Reliability

- Password hashing with bcrypt
- JWT-based auth for protected dashboard and backend calls
- API-key validation for external recommendation access
- Zod request validation for critical request bodies
- Route-level rate limiting on auth and sensitive webhook endpoints
- Redis caching on recommendation proxy flow
- Graceful shutdown hooks in service runtime
- CORS allowlist support for controlled browser access

## Local Deployment

### Prerequisites

- Node.js 18+
- Python 3.9+
- Docker Desktop

### Start with Docker Compose

```bash
docker compose up --build
```

Default URLs:

- Frontend: `http://localhost:5173`
- Auth: `http://localhost:8080`
- ML backend: `http://localhost:8000`
- Webhooks: `http://localhost:3001`
- Agent service: `http://localhost:8002`

## Environment Configuration

Each backend service reads its own `.env`.

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

### Optional `frontend/s/.env`

```env
VITE_AUTH_API_URL=http://localhost:8080
VITE_ML_API_URL=http://localhost:8000
VITE_WEBHOOK_API_URL=http://localhost:3001
```

## Development Notes

- Keep `JWT_SECRET` aligned between auth and ML backend.
- Keep `BACK2_INTERNAL_KEY` aligned between webhooks and ML backend.
- Prefer a single Postgres instance with schemas: `auth`, `webhooks`, `recommender`.
- For local ML development, exclude generated model directories from hot-reload watchers to avoid interrupted training jobs.

## Operations and Troubleshooting

- If auth calls return `401`, confirm token validity and secret alignment.
- If recommendations return `404`, verify project exists and is `READY`.
- If external calls fail, verify API key and webhooks app registration.
- If event pipeline is silent, confirm Kafka broker connectivity and consumer health.
- If latency increases on repeated recommendation calls, verify Redis connectivity and cache path.
- If CORS blocks browser requests, update `CORS_ORIGINS` in service env files.

## Documentation Links

- Architecture and flow details: `ARCHITECTURE.md`
- Kafka-specific setup notes: `KAFKA_SETUP.md`
- Team onboarding notes: `TEAM_SETUP.md`
