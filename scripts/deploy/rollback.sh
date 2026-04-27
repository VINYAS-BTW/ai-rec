#!/usr/bin/env bash
# scripts/deploy/rollback.sh
# One-command rollback to the previous Docker Compose image tag.
# Usage: ./rollback.sh [previous-image-tag]
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
ROLLBACK_TAG="${1:-}"
ROLLBACK_STATE_FILE="$REPO_ROOT/.last_deploy_tag"

log() { echo "[rollback] $(date -u +%H:%M:%S) $*"; }

cd "$REPO_ROOT"

if [[ -z "$ROLLBACK_TAG" ]]; then
  if [[ -f "$ROLLBACK_STATE_FILE" ]]; then
    ROLLBACK_TAG=$(cat "$ROLLBACK_STATE_FILE")
    log "Using saved previous tag: $ROLLBACK_TAG"
  else
    log "ERROR: No rollback tag provided and no saved tag found."
    log "Usage: ./rollback.sh <previous-image-tag>"
    exit 1
  fi
fi

log "Rolling back to tag=$ROLLBACK_TAG"
IMAGE_TAG="$ROLLBACK_TAG" docker compose pull || true
IMAGE_TAG="$ROLLBACK_TAG" docker compose up -d --build

log "Rollback complete. Stack running on tag=$ROLLBACK_TAG"
