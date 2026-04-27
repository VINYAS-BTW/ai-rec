# Pending Work

This file tracks pending and completed work against the target SuperAgent architecture in `docs/superagent.pdf`.

## Status Key

- `[x]` Completed and in active use
- `[~]` Implemented in code, partially enabled, or runtime-dependent
- `[ ]` Pending
- `[c]` Cancelled or intentionally deferred for current scope

## Completed / Delivered

- `[x]` Event-driven backbone (Kafka producer + consumer + PostgreSQL sink)
- `[x]` Stream processor mode in webhooks consumer (`realtime-v2`)
- `[x]` Model lifecycle controls (champion/challenger, promote/retire flows)
- `[x]` Shadow serving and serving latency controls
- `[x]` Feature store tables and feature APIs (online/offline patterns in current build)
- `[x]` Vector similarity support via FAISS for items/users
- `[x]` Request validation using Zod on key auth and webhook routes
- `[x]` Route-level rate limiting on auth and webhook-sensitive endpoints
- `[x]` Redis-backed caching for recommendation proxy path

## Implemented but Runtime-Dependent

- `[~]` Schema governance with Schema Registry compatibility checks
  - Code path exists and was previously configured.
  - Current local Docker runtime intentionally runs without Schema Registry container.
  - Keep as runtime-optional unless strict schema governance is required in deployment.

## High Priority Pending

- `[ ]` Resilience controls: retry policy, circuit breaker, timeout, fallback strategy.
- `[ ]` Persistent SuperAgent session management (replace in-memory/session-local behavior).
- `[ ]` Unified cache strategy for frequently requested recommendation/context option endpoints.

## SuperAgent Architecture Gaps

- `[x]` Formalize `IAgent` and `IMediator` contracts across service boundaries (`/v1/contracts` + typed Python contracts).
- `[x]` Add dynamic agent registry for `resolveAgent(domain)` to remove hard-coded dispatch.
- `[x]` Implement mediator fan-out and coordinated multi-agent response flows.
- `[x]` Add recommendation aggregation layer for cross-agent merge/rank policies (`score_desc` + `rrf`).
- `[x]` Define federated data hooks (`fetchData`, `getUserProfile`) with shared access controls.
- `[x]` Add explicit feedback submission flow from UI/client through mediator.
- `[x]` Add per-agent runtime health and latency observability hooks.

## Data and ML Platform

- `[x]` Add data lake / warehouse pipelines for raw and aggregated analytics.
- `[x]` Harden ETL-based retrain trigger controls and observability thresholds.

### Feedback Loop Items

- `[~]` Improve online feature updater for user/item embeddings from fresh events.
- `[~]` Harden negative/implicit feedback production coverage across all UX/API touchpoints.
- `[x]` Tighten automated retraining trigger quality gates based on sufficient fresh feedback.

## Agent and Recommendation Intelligence

- `[ ]` Add business rule engine (policy, compliance, filtering, promotion controls).
- `[ ]` Add explainability service (reason codes, contribution summaries).
- `[ ]` Expand SuperAgent orchestration depth for multi-agent planning.
- `[ ]` Strengthen feedback-to-training automation loop.

## Security and Platform Edge

- `[~]` API gateway controls
  - Request validation and rate limiting are now implemented at service level.
  - Dedicated gateway tier (central routing/versioning/policies) remains pending.
- `[ ]` Add IAM/RBAC layer beyond JWT-based identity.
- `[ ]` Add safety/guardrails service for PII scrubbing and output validation.

## Experimentation, Observability, and Operations

- `[x]` Add experimentation service (A/B assignment, variant evaluation).
- `[x]` Extend admin dashboard with full system/model operational metrics.
- `[x]` Add CI/CD automation for training/testing/deployment lifecycle.
- `[x]` Add container registry and deployment controller (canary/blue-green/rollback).
- `[x]` Add Kubernetes orchestration capabilities (autoscaling, self-healing, service discovery).
- `[x]` Add disaster recovery controls (backup/restore, multi-region failover).

## Milestone View (Updated)

### Milestone 1: Production MVP Hardening

- `[ ]` Persistent sessions
- `[ ]` Resilience manager
- `[x]` Cache service (Redis-based recommendation caching)
- `[~]` Basic API gateway policies (partially covered by service-level validation + rate limits)
- `[ ]` Expanded monitoring and logs

### Milestone 2: Event-Driven Feedback Loop

- `[x]` Kafka/event streaming
- `[~]` Schema registry (implemented path, runtime optional)
- `[x]` Stream processor
- `[~]` Online feature updater maturity

### Milestone 3: Advanced ML Platform

- `[x]` Model registry/service lifecycle controls
- `[ ]` Explainability + business rules
- `[x]` Experiment service

### Milestone 4: Infrastructure Maturity

- `[x]` CI/CD + deployment controller
- `[x]` Kubernetes scaling/health automation
- `[x]` Disaster recovery + multi-region readiness





### Extras: 

- `[x]` Give worst carrier, agent tuning
