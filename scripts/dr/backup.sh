#!/usr/bin/env bash
# scripts/dr/backup.sh — Backup PostgreSQL + Redis data
# Usage: ./backup.sh [s3://bucket/path]   (S3 upload is optional)
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/opt/backups/ai-rec-mine}"
TIMESTAMP=$(date -u +%Y%m%d_%H%M%S)
S3_TARGET="${1:-}"

log() { echo "[backup] $(date -u +%H:%M:%S) $*"; }

mkdir -p "$BACKUP_DIR"

# ── PostgreSQL ────────────────────────────────────────────────────────────────
PG_FILE="$BACKUP_DIR/postgres_${TIMESTAMP}.dump"
log "Dumping PostgreSQL → $PG_FILE"
docker compose exec -T db pg_dump \
  -U postgres \
  -d airec \
  --format=custom \
  --compress=9 \
  > "$PG_FILE"
log "PostgreSQL dump: $(du -sh "$PG_FILE" | cut -f1)"

# ── Redis ─────────────────────────────────────────────────────────────────────
REDIS_FILE="$BACKUP_DIR/redis_${TIMESTAMP}.rdb"
log "Saving Redis snapshot"
docker compose exec -T redis redis-cli BGSAVE
sleep 3
docker compose cp redis:/data/dump.rdb "$REDIS_FILE" 2>/dev/null || \
  docker compose exec -T redis cat /data/dump.rdb > "$REDIS_FILE"
log "Redis dump: $(du -sh "$REDIS_FILE" | cut -f1)"

# ── Upload to S3 (optional) ───────────────────────────────────────────────────
if [[ -n "$S3_TARGET" ]]; then
  log "Uploading to $S3_TARGET"
  aws s3 cp "$PG_FILE"    "$S3_TARGET/postgres_${TIMESTAMP}.dump"
  aws s3 cp "$REDIS_FILE" "$S3_TARGET/redis_${TIMESTAMP}.rdb"
  log "Upload complete"
fi

# ── Retention: keep last 7 backups ───────────────────────────────────────────
find "$BACKUP_DIR" -name "postgres_*.dump" | sort | head -n -7 | xargs -r rm -f
find "$BACKUP_DIR" -name "redis_*.rdb"     | sort | head -n -7 | xargs -r rm -f

log "Backup complete. Files in $BACKUP_DIR"
