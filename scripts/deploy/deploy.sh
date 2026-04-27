#!/usr/bin/env bash
# scripts/deploy/deploy.sh
# Blue-green / canary deployment controller for Docker Compose.
# Usage: ./deploy.sh <IMAGE_TAG> [blue-green|canary] [canary_percent]
set -euo pipefail

IMAGE_TAG="${1:-latest}"
STRATEGY="${2:-blue-green}"
CANARY_PCT="${3:-10}"
COMPOSE_FILE="docker-compose.yml"
REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"

log() { echo "[deploy] $(date -u +%H:%M:%S) $*"; }

health_check() {
  local svc="$1" port="$2" path="${3:-/health}"
  local deadline=$((SECONDS + 60))
  until curl -sf "http://localhost:${port}${path}" >/dev/null 2>&1; do
    if [[ $SECONDS -ge $deadline ]]; then
      log "FAIL: $svc not healthy after 60 s"
      return 1
    fi
    sleep 3
  done
  log "OK: $svc healthy"
}

cd "$REPO_ROOT"

if [[ "$STRATEGY" == "blue-green" ]]; then
  log "Blue-green deploy — tag=$IMAGE_TAG"

  # 1. Pull new images
  IMAGE_TAG="$IMAGE_TAG" docker compose pull || true

  # 2. Bring up new stack with a temporary project name (green)
  GREEN_PROJECT="airec-green"
  IMAGE_TAG="$IMAGE_TAG" docker compose -p "$GREEN_PROJECT" up -d --build

  # 3. Health-check green stack
  health_check "back2-green"   8001 "/health"   || { log "Green unhealthy — aborting"; docker compose -p "$GREEN_PROJECT" down; exit 1; }
  health_check "auth-green"    8081 "/"          || { docker compose -p "$GREEN_PROJECT" down; exit 1; }
  health_check "webhooks-green" 3002 "/api/apps" || { docker compose -p "$GREEN_PROJECT" down; exit 1; }

  # 4. Swap: stop blue (default project)
  log "Green healthy — stopping blue stack"
  docker compose -p airec down || true

  # 5. Rename green → default
  IMAGE_TAG="$IMAGE_TAG" docker compose up -d --build
  docker compose -p "$GREEN_PROJECT" down || true

  log "Blue-green deploy complete. Tag=$IMAGE_TAG"

elif [[ "$STRATEGY" == "canary" ]]; then
  log "Canary deploy — tag=$IMAGE_TAG pct=$CANARY_PCT%"

  # Scale down 1 replica of the running back2 and replace it with the new image
  CURRENT=$(docker compose ps --quiet back2 | head -n 1)
  IMAGE_TAG="$IMAGE_TAG" docker compose up -d --no-deps --scale back2=2 back2

  log "Canary instance started. Monitor for 60 s before promoting."
  sleep 60

  # Check health of canary
  health_check "back2-canary" 8000 "/health" || {
    log "Canary unhealthy — rolling back single instance"
    docker compose up -d --no-deps --scale back2=1 back2
    exit 1
  }

  log "Canary healthy — promoting to full rollout"
  IMAGE_TAG="$IMAGE_TAG" docker compose up -d --no-deps back2
  docker compose up -d --no-deps --scale back2=1 back2
  log "Canary promoted. Tag=$IMAGE_TAG"

else
  log "Unknown strategy '$STRATEGY'. Use blue-green or canary."
  exit 1
fi
