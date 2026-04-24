
import asyncio
import hashlib
import json
import logging
import os
import urllib.request
import urllib.error
import urllib.parse
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, Optional

logger = logging.getLogger("kafka.producer")

# ── Config ────────────────────────────────────────────────────────────────────
ENABLED: bool = os.getenv("EVENT_LOGGING_ENABLED", "true").lower() != "false"
BROKERS: str = os.getenv("KAFKA_BROKERS", "localhost:9092")
CLIENT_ID: str = os.getenv("KAFKA_CLIENT_ID", "fastapi-recommender")
TOPIC: str = os.getenv("KAFKA_TOPIC_EVENTS", "rec.events.v1")
KAFKA_SSL: bool = os.getenv("KAFKA_SSL", "false").lower() == "true"
SASL_MECHANISM: Optional[str] = os.getenv("KAFKA_SASL_MECHANISM")  # PLAIN | SCRAM-SHA-256
SASL_USER: Optional[str] = os.getenv("KAFKA_SASL_USERNAME")
SASL_PASS: Optional[str] = os.getenv("KAFKA_SASL_PASSWORD")
CURRENT_SCHEMA_VERSION: int = int(os.getenv("EVENT_SCHEMA_VERSION", "1"))
SUPPORTED_SCHEMA_VERSIONS = {CURRENT_SCHEMA_VERSION}
CB_FAILURE_THRESHOLD: int = int(os.getenv("KAFKA_CB_FAILURE_THRESHOLD", "5"))
CB_WINDOW_SECONDS: int = int(os.getenv("KAFKA_CB_WINDOW_MS", "60000")) // 1000
CB_COOLDOWN_SECONDS: int = int(os.getenv("KAFKA_CB_COOLDOWN_MS", "30000")) // 1000
SCHEMA_REGISTRY_ENABLED: bool = os.getenv("SCHEMA_REGISTRY_ENABLED", "false").lower() == "true"
SCHEMA_REGISTRY_REQUIRED: bool = os.getenv("SCHEMA_REGISTRY_REQUIRED", "true").lower() != "false"
SCHEMA_REGISTRY_URL: str = os.getenv("SCHEMA_REGISTRY_URL", "http://localhost:8081").rstrip("/")
KAFKA_SCHEMA_SUBJECT: str = os.getenv("KAFKA_SCHEMA_SUBJECT", f"{TOPIC}-value")
SCHEMA_REGISTRY_COMPATIBILITY: str = os.getenv("SCHEMA_REGISTRY_COMPATIBILITY", "BACKWARD")
SCHEMA_REGISTRY_TIMEOUT_SECONDS: int = int(os.getenv("SCHEMA_REGISTRY_TIMEOUT_MS", "5000")) // 1000

EVENT_JSON_SCHEMA: Dict[str, Any] = {
    "type": "object",
    "additionalProperties": True,
    "required": ["event_id", "event_type", "schema_version", "occurred_at", "source_service"],
    "properties": {
        "event_id": {"type": "string", "minLength": 1},
        "event_type": {
            "type": "string",
            "enum": ["click", "rating", "skip", "dwell", "recommendation_served", "training_completed"],
        },
        "schema_version": {"type": "integer", "minimum": 1},
        "occurred_at": {"type": "string", "format": "date-time"},
        "source_service": {"type": "string", "minLength": 1},
        "api_route": {"type": ["string", "null"]},
        "project_id": {"type": ["integer", "string", "null"]},
        "user_id": {"type": ["integer", "string", "null"]},
        "app_name": {"type": ["string", "null"]},
        "api_key_hash": {"type": ["string", "null"]},
        "session_id": {"type": ["string", "null"]},
        "correlation_id": {"type": ["string", "null"]},
        "item_id": {"type": ["string", "integer", "null"]},
        "item_title": {"type": ["string", "null"]},
        "rating_value": {"type": ["number", "null"]},
        "dwell_time_ms": {"type": ["number", "integer", "null"]},
        "recommendation_count": {"type": ["integer", "null"]},
        "recommendations_preview": {"type": ["array", "null"]},
        "metadata": {"type": "object"},
    },
}

# Lazy-imported so aiokafka is optional (service starts without it)
_producer = None
_producer_lock = asyncio.Lock() if asyncio.get_event_loop().is_running() else None
_schema_lock = asyncio.Lock() if asyncio.get_event_loop().is_running() else None
_breaker = {"failures": [], "open_until": 0}
_schema_registry = {
    "ready": not SCHEMA_REGISTRY_ENABLED,
    "schema_id": None,
    "last_error": None,
}
_status: Dict[str, Any] = {
    "last_attempt_at": None,
    "last_success_at": None,
    "last_error": None,
    "last_event_id": None,
    "last_event_type": None,
    "total_success": 0,
    "total_failures": 0,
}

# ── Helpers ───────────────────────────────────────────────────────────────────

def hash_api_key(raw_key: Optional[str]) -> Optional[str]:
    """SHA-256 hex digest of the raw API key. Returns None if input is falsy."""
    if not raw_key:
        return None
    return hashlib.sha256(raw_key.encode()).hexdigest()


def resolve_message_key(event: Dict) -> bytes:
    """project_id → app_name → event_id (per spec)."""
    key = event.get("project_id") or event.get("app_name") or event.get("event_id")
    return str(key).encode()


def _now_ts() -> float:
    return datetime.now(timezone.utc).timestamp()


def _cleanup_failures(now_ts: Optional[float] = None) -> None:
    now_ts = now_ts or _now_ts()
    _breaker["failures"] = [ts for ts in _breaker["failures"] if now_ts - ts <= CB_WINDOW_SECONDS]


def _breaker_open(now_ts: Optional[float] = None) -> bool:
    now_ts = now_ts or _now_ts()
    return _breaker["open_until"] > now_ts


def _record_failure() -> None:
    now_ts = _now_ts()
    _breaker["failures"].append(now_ts)
    _cleanup_failures(now_ts)
    if len(_breaker["failures"]) >= CB_FAILURE_THRESHOLD:
        _breaker["open_until"] = now_ts + CB_COOLDOWN_SECONDS
        _breaker["failures"] = []
        logger.warning("[kafka/producer] Circuit breaker opened for %s seconds", CB_COOLDOWN_SECONDS)


def _record_success() -> None:
    _breaker["failures"] = []
    _breaker["open_until"] = 0


def _schema_registry_request(method: str, path: str, payload: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    req = urllib.request.Request(
        url=f"{SCHEMA_REGISTRY_URL}{path}",
        method=method,
        headers={
            "Content-Type": "application/vnd.schemaregistry.v1+json",
            "Accept": "application/vnd.schemaregistry.v1+json",
        },
    )
    body = None
    if payload is not None:
        body = json.dumps(payload).encode("utf-8")
    try:
        with urllib.request.urlopen(req, data=body, timeout=max(1, SCHEMA_REGISTRY_TIMEOUT_SECONDS)) as res:
            raw = res.read().decode("utf-8") if res.length != 0 else ""
            if raw:
                try:
                    parsed = json.loads(raw)
                except Exception:
                    parsed = {"raw": raw}
            else:
                parsed = None
            return {"ok": True, "status": res.status, "body": parsed}
    except urllib.error.HTTPError as err:
        raw = err.read().decode("utf-8") if err.fp else ""
        if raw:
            try:
                parsed = json.loads(raw)
            except Exception:
                parsed = {"raw": raw}
        else:
            parsed = None
        return {"ok": False, "status": err.code, "body": parsed}


async def _ensure_schema_registry_ready() -> bool:
    global _schema_lock

    if not SCHEMA_REGISTRY_ENABLED:
        return True
    if _schema_registry["ready"] and _schema_registry["schema_id"]:
        return True

    if _schema_lock is None:
        _schema_lock = asyncio.Lock()

    async with _schema_lock:
        if _schema_registry["ready"] and _schema_registry["schema_id"]:
            return True

        payload = {
            "schemaType": "JSON",
            "schema": json.dumps(EVENT_JSON_SCHEMA),
        }
        subject = urllib.parse.quote(KAFKA_SCHEMA_SUBJECT, safe="")

        try:
            await asyncio.to_thread(
                _schema_registry_request,
                "PUT",
                f"/config/{subject}",
                {"compatibility": SCHEMA_REGISTRY_COMPATIBILITY},
            )

            compatibility = await asyncio.to_thread(
                _schema_registry_request,
                "POST",
                f"/compatibility/subjects/{subject}/versions/latest",
                payload,
            )
            if compatibility["status"] != 404 and compatibility["ok"] and compatibility["body"] and compatibility["body"].get("is_compatible") is False:
                raise RuntimeError(f"Schema incompatible for subject {KAFKA_SCHEMA_SUBJECT}")

            register = await asyncio.to_thread(
                _schema_registry_request,
                "POST",
                f"/subjects/{subject}/versions",
                payload,
            )
            if (not register["ok"]) or (not register["body"]) or (not register["body"].get("id")):
                raise RuntimeError(f"Schema register failed: HTTP {register['status']}")

            _schema_registry["ready"] = True
            _schema_registry["schema_id"] = str(register["body"]["id"])
            _schema_registry["last_error"] = None
            logger.info(
                "[kafka/producer] Schema Registry ready: subject=%s id=%s compatibility=%s",
                KAFKA_SCHEMA_SUBJECT,
                _schema_registry["schema_id"],
                SCHEMA_REGISTRY_COMPATIBILITY,
            )
            return True

        except Exception as exc:
            _schema_registry["ready"] = False
            _schema_registry["schema_id"] = None
            _schema_registry["last_error"] = str(exc)
            if SCHEMA_REGISTRY_REQUIRED:
                raise
            logger.warning("[kafka/producer] Schema Registry bootstrap failed: %s", exc)
            return False


def validate_event(event: Dict) -> Optional[str]:
    """Returns an error string if invalid, else None."""
    valid_types = {
        "click",
        "rating",
        "skip",
        "dwell",
        "recommendation_served",
        "training_completed",
    }
    if event.get("event_type") not in valid_types:
        return f"event_type must be one of {valid_types}"

    try:
        schema_version = int(event.get("schema_version") or CURRENT_SCHEMA_VERSION)
    except Exception:
        return "schema_version must be an integer"
    if schema_version not in SUPPORTED_SCHEMA_VERSIONS:
        return f"schema_version must be one of {sorted(SUPPORTED_SCHEMA_VERSIONS)}"

    if not event.get("occurred_at"):
        return "occurred_at is required"
    if not event.get("source_service"):
        return "source_service is required"

    if event.get("event_type") == "rating":
        if event.get("rating_value") is None:
            return "rating_value is required for rating events"
        min_rating = float(os.getenv("EVENT_RATING_MIN", "1"))
        max_rating = float(os.getenv("EVENT_RATING_MAX", "5"))
        try:
            rating_num = float(event.get("rating_value"))
        except Exception:
            return "rating_value must be numeric"
        if rating_num < min_rating or rating_num > max_rating:
            return f"rating_value must be a number between {min_rating} and {max_rating}"

    if event.get("event_type") == "click":
        if not event.get("item_id"):
            return "item_id is required for click events"

    if event.get("event_type") == "skip":
        if not event.get("item_id"):
            return "item_id is required for skip events"

    if event.get("event_type") == "dwell":
        if not event.get("item_id"):
            return "item_id is required for dwell events"
        dwell_value = event.get("dwell_time_ms") if event.get("dwell_time_ms") is not None else event.get("dwell_time_seconds")
        try:
            dwell_num = float(dwell_value)
        except Exception:
            return "dwell_time_ms or dwell_time_seconds must be numeric"
        if dwell_num <= 0:
            return "dwell_time_ms or dwell_time_seconds must be a positive number"

    return None


async def _get_producer():
    global _producer, _producer_lock

    if _producer is not None:
        return _producer

    if _producer_lock is None:
        _producer_lock = asyncio.Lock()

    async with _producer_lock:
        if _producer is not None:
            return _producer

        try:
            from aiokafka import AIOKafkaProducer
            from aiokafka.helpers import create_ssl_context

            ssl_context = create_ssl_context() if (KAFKA_SSL or SASL_MECHANISM) else None

            sasl_kwargs: Dict[str, Any] = {}
            if SASL_MECHANISM and SASL_USER and SASL_PASS:
                sasl_kwargs = {
                    "sasl_mechanism": SASL_MECHANISM.upper(),
                    "sasl_plain_username": SASL_USER,
                    "sasl_plain_password": SASL_PASS,
                }

            _producer = AIOKafkaProducer(
                bootstrap_servers=BROKERS,
                client_id=CLIENT_ID,
                acks="all",
                compression_type="gzip",
                request_timeout_ms=5000,
                retry_backoff_ms=300,
                enable_idempotence=True,
                ssl_context=ssl_context,
                **sasl_kwargs,
            )
            await _producer.start()
            _status["last_error"] = None
            logger.info("[kafka/producer] Connected to brokers: %s", BROKERS)
            return _producer

        except ImportError:
            logger.warning("[kafka/producer] aiokafka not installed — Kafka logging disabled")
            _status["last_error"] = "aiokafka not installed"
            return None
        except Exception as exc:
            logger.warning("[kafka/producer] Failed to connect — running without Kafka: %s", exc)
            _record_failure()
            _status["total_failures"] += 1
            _status["last_error"] = str(exc)
            _producer = None
            return None


async def shutdown_producer():
    """Call from FastAPI lifespan shutdown to disconnect cleanly."""
    global _producer
    if _producer is not None:
        try:
            await _producer.stop()
            logger.info("[kafka/producer] Producer disconnected gracefully")
        except Exception as exc:
            logger.warning("[kafka/producer] Error during disconnect: %s", exc)
        finally:
            _producer = None


# ── Core: emit_event ──────────────────────────────────────────────────────────

async def emit_event(partial: Dict[str, Any]) -> Optional[str]:
    """
    Enrich, validate, and produce one event to Kafka.

    Safe-failure: any exception is caught and logged — never re-raised.
    Returns event_id on success, None on skip/failure.

    Args:
        partial: dict with any subset of the event contract fields.
                 Use _raw_api_key to pass the unhashed key; it will be
                 hashed before producing and removed from the payload.
    """
    if not ENABLED:
        return None
    _status["last_attempt_at"] = datetime.now(timezone.utc).isoformat()
    if _breaker_open():
        _status["total_failures"] += 1
        _status["last_error"] = "circuit breaker open"
        logger.warning(
            "[kafka/producer] Circuit breaker open — event dropped | api_route=%s",
            partial.get("api_route"),
        )
        return None

    try:
        registry_ok = await _ensure_schema_registry_ready()
    except Exception as exc:
        _status["total_failures"] += 1
        _status["last_error"] = f"schema registry required: {exc}"
        logger.warning("[kafka/producer] Schema Registry required but unavailable — event dropped: %s", exc)
        return None

    if SCHEMA_REGISTRY_ENABLED and not registry_ok:
        _status["total_failures"] += 1
        _status["last_error"] = _schema_registry["last_error"] or "schema registry unavailable"
        logger.warning("[kafka/producer] Schema Registry unavailable — event dropped")
        return None

    # ── Enrich ────────────────────────────────────────────────────────────────
    try:
        schema_version = int(partial.get("schema_version") or CURRENT_SCHEMA_VERSION)
    except Exception:
        schema_version = CURRENT_SCHEMA_VERSION
    dwell_ms = partial.get("dwell_time_ms")
    if dwell_ms is None and partial.get("dwell_time_seconds") is not None:
        try:
            dwell_ms = int(float(partial.get("dwell_time_seconds")) * 1000)
        except Exception:
            dwell_ms = None
    event: Dict[str, Any] = {
        "event_id":               partial.get("event_id") or str(uuid.uuid4()),
        "event_type":             partial.get("event_type"),
        "schema_version":         schema_version,
        "occurred_at":            partial.get("occurred_at") or datetime.now(timezone.utc).isoformat(),
        "source_service":         partial.get("source_service", "fastapi-recommender"),
        "api_route":              partial.get("api_route"),
        "project_id":             partial.get("project_id"),
        "user_id":                partial.get("user_id"),
        "app_name":               partial.get("app_name"),
        "api_key_hash":           hash_api_key(partial.get("_raw_api_key")) or partial.get("api_key_hash"),
        "session_id":             partial.get("session_id"),
        "correlation_id":         partial.get("correlation_id"),
        "item_id":                partial.get("item_id"),
        "item_title":             partial.get("item_title"),
        "rating_value":           partial.get("rating_value"),
        "dwell_time_ms":          dwell_ms,
        "recommendation_count":   partial.get("recommendation_count"),
        "recommendations_preview": partial.get("recommendations_preview"),
        "metadata":               partial.get("metadata") or {},
    }
    # Never produce raw key
    event.pop("_raw_api_key", None)

    # ── Validate ──────────────────────────────────────────────────────────────
    error = validate_event(event)
    if error:
        _status["total_failures"] += 1
        _status["last_error"] = error
        _status["last_event_type"] = event.get("event_type")
        logger.warning(
            "[kafka/producer] Invalid event — skipping: %s | event_id=%s event_type=%s",
            error, event.get("event_id"), event.get("event_type"),
        )
        return None

    if _breaker_open():
        _status["total_failures"] += 1
        _status["last_error"] = "circuit breaker open"
        _status["last_event_type"] = event.get("event_type")
        logger.warning(
            "[kafka/producer] Circuit breaker open — event dropped | api_route=%s",
            event.get("api_route"),
        )
        return None

    # ── Produce ───────────────────────────────────────────────────────────────
    producer = await _get_producer()
    if producer is None:
        _status["total_failures"] += 1
        _status["last_error"] = "producer unavailable"
        _status["last_event_type"] = event.get("event_type")
        logger.warning(
            "[kafka/producer] Producer unavailable — event dropped | event_id=%s api_route=%s",
            event["event_id"], event.get("api_route"),
        )
        return None

    try:
        await producer.send_and_wait(
            TOPIC,
            key=resolve_message_key(event),
            value=json.dumps(event).encode(),
            headers=[
                ("event-type",    event["event_type"].encode()),
                ("source-service", event["source_service"].encode()),
                *((
                    [
                        ("schema-id", _schema_registry["schema_id"].encode()),
                        ("schema-subject", KAFKA_SCHEMA_SUBJECT.encode()),
                        ("schema-version", str(event["schema_version"]).encode()),
                    ]
                ) if (_schema_registry.get("schema_id") and SCHEMA_REGISTRY_ENABLED) else []),
            ],
        )
        _record_success()
        _status["last_success_at"] = datetime.now(timezone.utc).isoformat()
        _status["last_error"] = None
        _status["last_event_id"] = event.get("event_id")
        _status["last_event_type"] = event.get("event_type")
        _status["total_success"] += 1
        return event["event_id"]

    except Exception as exc:
        _record_failure()
        _status["total_failures"] += 1
        _status["last_error"] = str(exc)
        _status["last_event_id"] = event.get("event_id")
        _status["last_event_type"] = event.get("event_type")
        logger.warning(
            "[kafka/producer] Produce failed — event dropped | event_id=%s api_route=%s error=%s",
            event["event_id"], event.get("api_route"), exc,
        )
        return None


def get_kafka_status() -> Dict[str, Any]:
    now_ts = _now_ts()
    return {
        "enabled": ENABLED,
        "brokers": BROKERS,
        "topic": TOPIC,
        "client_id": CLIENT_ID,
        "producer_initialized": _producer is not None,
        "circuit_breaker_open": _breaker_open(now_ts),
        "circuit_breaker_open_until": _breaker["open_until"],
        "recent_failure_count": len(_breaker["failures"]),
        "last_attempt_at": _status["last_attempt_at"],
        "last_success_at": _status["last_success_at"],
        "last_error": _status["last_error"],
        "last_event_id": _status["last_event_id"],
        "last_event_type": _status["last_event_type"],
        "total_success": _status["total_success"],
        "total_failures": _status["total_failures"],
        "schema_registry_enabled": SCHEMA_REGISTRY_ENABLED,
        "schema_registry_required": SCHEMA_REGISTRY_REQUIRED,
        "schema_registry_url": SCHEMA_REGISTRY_URL,
        "schema_subject": KAFKA_SCHEMA_SUBJECT,
        "schema_registry_ready": _schema_registry["ready"],
        "schema_registry_schema_id": _schema_registry["schema_id"],
        "schema_registry_last_error": _schema_registry["last_error"],
    }


async def emit_event_bg(partial: Dict[str, Any]) -> None:
    """Thin wrapper for use with FastAPI BackgroundTasks. Never raises."""
    await emit_event(partial)