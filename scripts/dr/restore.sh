#!/usr/bin/env bash
# scripts/dr/restore.sh — Restore PostgreSQL + Redis from backup
# Usage: ./restore.sh <postgres_dump_file> [redis_rdb_file]
set -euo pipefail

PG_FILE="${1:-}"
REDIS_FILE="${2:-}"

log() { echo "[restore] $(date -u +%H:%M:%S) $*"; }

if [[ -z "$PG_FILE" ]]; then
  echo "Usage: ./restore.sh <postgres.dump> [redis.rdb]"
  exit 1
fi

if [[ ! -f "$PG_FILE" ]]; then
  log "ERROR: $PG_FILE not found"
  exit 1
fi

log "WARNING: This will OVERWRITE the current database. Ctrl-C to abort (5s)."
sleep 5

# ── PostgreSQL restore ────────────────────────────────────────────────────────
log "Restoring PostgreSQL from $PG_FILE"
docker compose exec -T db psql -U postgres -c "DROP DATABASE IF EXISTS airec_restore;" 2>/dev/null || true
docker compose exec -T db psql -U postgres -c "CREATE DATABASE airec_restore;" 2>/dev/null || true
docker compose exec -T db pg_restore \
  -U postgres \
  -d airec \
  --clean \
  --if-exists \
  < "$PG_FILE"
log "PostgreSQL restore complete"

# ── Redis restore ─────────────────────────────────────────────────────────────
if [[ -n "$REDIS_FILE" && -f "$REDIS_FILE" ]]; then
  log "Restoring Redis from $REDIS_FILE"
  docker compose exec -T redis redis-cli SHUTDOWN NOSAVE 2>/dev/null || true
  sleep 2
  docker compose cp "$REDIS_FILE" redis:/data/dump.rdb
  docker compose start redis
  log "Redis restore complete"
fi

log "Restore finished. Restart services: docker compose up -d"
