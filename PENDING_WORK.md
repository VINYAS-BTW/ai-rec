# Pending Work

This file tracks the major items still pending compared to the target SuperAgent architecture in `docs/superagent.pdf`.

## Completed ✅

- **Build event-driven backbone: Kafka/event bus** ✅ Implemented:
  - Apache Kafka Docker broker running on localhost:9092
  - Producer: async emit_event() in FastAPI backend (backend/back2/kafka/producer.py)
  - Consumer: Kafka consumer in Node.js persisting to PostgreSQL (backend/webhooks_services/workers/eventConsumer.js)
  - Event types: click, rating, skip, dwell, recommendation_served, **training_completed** (newly added)
  - Topics: rec.events.v1 (events), rec.events.dlq.v1 (dead-letter queue)
  - End-to-end validation: events successfully flow from backend → Kafka → consumer → PostgreSQL
  - See KAFKA_SETUP.md and TEAM_SETUP.md for detailed setup

- **Add schema governance: schema registry + compatibility checks before publishing events** ✅ Implemented:
  - Docker service: Confluent Schema Registry on `http://localhost:8081`
  - Subject compatibility policy: `BACKWARD` (configurable via env)
  - Producers now register/check JSON schema under subject `rec.events.v1-value` before publishing
  - Producers attach schema metadata headers (`schema-id`, `schema-subject`, `schema-version`) on events

- **Implement stream processor + online feature updater for near-real-time signals** ✅ Implemented:
  - Upgraded Kafka worker to real-time processor mode (`realtime-v2`) with batch-aware consumption
  - Controlled partition concurrency via `KAFKA_PARTITIONS_CONSUMED_CONCURRENTLY`
  - Low-latency commit strategy with heartbeat-safe processing and lag threshold alerts
  - Continues to update online feature rollups and retrain triggers from live events

- **Formalize model registry/service lifecycle (champion/challenger, promotion/retire flow)** ✅ Implemented:
  - Added persistent model registry table with per-project version history and lifecycle roles
  - New training snapshots now register as champion (first model) or challenger (subsequent models)
  - Added promote endpoint to switch champion and retire previous champion
  - Added retire endpoint for non-champion versions

- **Add model serving controls such as shadow traffic and latency monitoring** ✅ Implemented:
  - Added per-project serving controls (`shadow_enabled`, `shadow_percentage`, `latency_warn_ms`)
  - Inference now serves champion path with optional shadow challenger execution
  - Captures champion/challenger latency and shadow error/request counters
  - Added serving controls and serving metrics endpoints

- **Introduce a dedicated feature store service (online + offline feature access patterns)** ✅ Implemented:
  - Postgres-backed feature store with `user_features` and `item_features`
  - Training-time bulk materialization and online upserts for live feedback loops
  - Read APIs for single-entity lookup and admin/debug listings

- **Add vector DB for embeddings/similarity search (users/items)** ✅ Implemented:
  - Per-project FAISS vector store for items and users
  - Training-time index build and persisted indexes next to the model artifacts
  - Read APIs for similar items/users and vector-store status

## High Priority

- Implement resilience controls: retry policy, circuit breaker, timeout, fallback.
- Add persistent session management for SuperAgent (replace in-memory session store).
- Implement cache service for frequently requested recommendations/context options.

## SuperAgent Architecture Gaps

- Formalize the `IAgent` and `IMediator` contracts across the Python and Node services so agents are plug-and-play.
- Add an explicit agent registry for dynamic `resolveAgent(domain)` lookup instead of hard-coded domain dispatch.
- Implement mediator routing and broadcast flows for fan-out to multiple agents and response coordination.
- Add a recommendation aggregation layer that merges and ranks results from multiple agents consistently.
- Define federated data access hooks (`fetchData`, `getUserProfile`) with access checks and shared context propagation.
- Add explicit feedback submission flow from client/UI into the mediator and feedback loop.
- Add runtime observability hooks for latency monitoring, per-agent health, and pod/service monitoring.

## Data & ML Platform

- Add data lake and warehouse pipelines for raw + aggregated analytics data.

### Feedback Loop Gaps Still to Close

- Online feature updater for user/item embeddings from fresh Kafka events.
- Feedback producer hardening for richer negative/implicit signals (skip + dwell) at every relevant UI/API touchpoint.
- ETL retrain trigger hardening and observability so retraining fires only after enough fresh feedback accumulates.

## Agent & Recommendation Intelligence

- Add business rule engine for policy/compliance/content filtering and promotion rules.
- Add explainability service (reason codes, feature contribution summaries).
- Expand SuperAgent orchestration for stronger multi-agent planning/aggregation logic.
- Strengthen feedback loop to support automated retraining triggers from behavior signals.

## Security & Platform Edge

- Add API gateway layer (request validation, rate limiting, versioning, routing).
- Add IAM/RBAC service beyond JWT validation for role-based controls.
- Add guardrails service for PII scrubbing, output validation, and safety filtering.

## Experimentation, Observability, and Ops

- Add experiment service (A/B assignment, variant tracking, comparison).
- Extend admin dashboard with system metrics, model metrics, and operational logs.
- Add CI/CD automation for model training/testing/deployment lifecycle.
- Add container registry + deployment controller (canary/blue-green/rollback).
- Add Kubernetes orchestration features (autoscaling, self-healing, service discovery).
- Add disaster recovery manager (multi-region failover, backup/restore, RPO/RTO controls).

## Suggested Milestones

### Milestone 1: Production MVP Hardening

- Persistent sessions
- Resilience manager
- Cache service
- Basic API gateway policies
- Expanded monitoring and logs

### Milestone 2: Event-Driven Feedback Loop

- Kafka/event streaming
- Schema registry
- Stream processor
- Online feature updater

### Milestone 3: Advanced ML Platform

- Model registry/service lifecycle hardening
- Explainability + business rules
- Experiment service

### Milestone 4: Infra Maturity

- CI/CD + deployment controller
- Kubernetes scaling/health automation
- Disaster recovery + multi-region readiness
