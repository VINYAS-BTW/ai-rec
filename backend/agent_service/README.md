# Agent Service (Agent Layer)

This service is the **agent layer** on top of your existing recommender stack.

It provides:
- Domain-agent wrapper endpoints that call your FastAPI recommender (`backend/back2/`)
- An orchestrator endpoint that can call one or multiple domain agents and merge results

## Run

1. Install deps:
   - `cd backend/agent_service`
   - `pip install -r requirements.txt`
2. Create `.env`:
   - copy from `.env.example`
3. Start:
   - `uvicorn main:app --reload --port 8002`

## Key endpoints

- `GET /health`
- `POST /v1/domain/{domain_slug}/recommend`
- `POST /v1/orchestrate`

