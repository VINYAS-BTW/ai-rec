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

## High Priority

- Add schema governance: schema registry + compatibility checks before publishing events.
- Implement resilience controls: retry policy, circuit breaker, timeout, fallback.
- Add persistent session management for SuperAgent (replace in-memory session store).
- Implement cache service for frequently requested recommendations/context options.

## Data & ML Platform

- Introduce a dedicated feature store service (online + offline feature access patterns).
- Add vector DB for embeddings/similarity search (users/items).
- Implement stream processor + online feature updater for near-real-time signals.
- Add data lake and warehouse pipelines for raw + aggregated analytics data.
- Formalize model registry/service lifecycle (champion/challenger, promotion/retire flow).
- Add model serving controls such as shadow traffic and latency monitoring.

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

- Feature store + vector DB
- Model registry/service lifecycle hardening
- Explainability + business rules
- Experiment service

### Milestone 4: Infra Maturity

- CI/CD + deployment controller
- Kubernetes scaling/health automation
- Disaster recovery + multi-region readiness
