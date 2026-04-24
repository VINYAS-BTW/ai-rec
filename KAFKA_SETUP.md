# Kafka Setup

## Install & Start (Docker)

**All platforms (Windows, Mac, Linux):**
```bash
docker run -d --name kafka -p 9092:9092 apache/kafka:latest
```

Start Schema Registry (required for schema governance):
```bash
docker run -d --name schema-registry -p 8081:8081 \
  -e SCHEMA_REGISTRY_HOST_NAME=schema-registry \
  -e SCHEMA_REGISTRY_LISTENERS=http://0.0.0.0:8081 \
  -e SCHEMA_REGISTRY_KAFKASTORE_BOOTSTRAP_SERVERS=PLAINTEXT://host.docker.internal:9092 \
  -e SCHEMA_REGISTRY_SCHEMA_COMPATIBILITY_LEVEL=BACKWARD \
  confluentinc/cp-schema-registry:7.7.1
```

Verify it's running:
```bash
docker ps | grep kafka
```

## Config (.env)

Add to both `backend/back2/.env` and `backend/webhooks_services/.env`:
```env
KAFKA_BROKERS=localhost:9092
EVENT_LOGGING_ENABLED=true
SCHEMA_REGISTRY_ENABLED=true
SCHEMA_REGISTRY_REQUIRED=true
SCHEMA_REGISTRY_URL=http://localhost:8081
KAFKA_SCHEMA_SUBJECT=rec.events.v1-value
SCHEMA_REGISTRY_COMPATIBILITY=BACKWARD
```

## Start Services

**Terminal 1 - Backend:**
```bash
cd backend/back2
python -m uvicorn saas_api:app --host 127.0.0.1 --port 8000
```

**Terminal 2 - Consumer:**
```bash
cd backend/webhooks_services
npm run start:realtime-processor
```

Optional tuning env vars for real-time mode:
```env
STREAM_PROCESSOR_MODE=realtime-v2
KAFKA_PARTITIONS_CONSUMED_CONCURRENTLY=3
KAFKA_MAX_BATCH_MESSAGES=100
KAFKA_LAG_WARN_THRESHOLD=1000
```

## Verify

1. Check Kafka running:
```bash
docker ps | grep kafka
```

2. Check consumer logs show:
```
[consumer] Consumer has joined the group
[consumer] Subscribed to topic: rec.events.v1
```

3. Verify schema registration exists:
```bash
curl http://localhost:8081/subjects/rec.events.v1-value/versions
```

Expected output: `[1]` (or a list with one or more versions)

4. Trigger training:
```bash
curl -X POST "http://127.0.0.1:8000/agent/v1/train-preset" \
  -H "X-Internal-Key: dev-internal-key-for-testing" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "preset=logistics_carriers&project_name=test"
```

5. Check database (wait ~60 seconds):
```bash
python -c "
import psycopg2, os
conn = psycopg2.connect(os.getenv('DATABASE_URL'))
cur = conn.cursor()
cur.execute('SELECT COUNT(*) FROM webhooks.event_logs WHERE event_type = %s', ('training_completed',))
print(f'Events: {cur.fetchone()[0]}')
cur.close()
"
```

Expected: `Events: 1` or higher

## Stop Kafka

```bash
docker stop kafka && docker rm kafka
docker stop schema-registry && docker rm schema-registry
```

## Troubleshooting

| Issue | Fix |
|-------|-----|
| Port 9092 in use | `docker stop kafka && docker rm kafka` |
| Consumer won't start | Check `KAFKA_BROKERS=localhost:9092` in `.env` |
| Events not in DB | Check backend logs for "Emitted Kafka event" |
| DB connection error | Set `DATABASE_URL` environment variable |
| Consumer won't start | Check `KAFKA_BROKERS=localhost:9092` in `.env` |
| Events not in DB | Check backend logs for "Emitted Kafka event" |
| DB connection error | Set `DATABASE_URL` environment variable |
