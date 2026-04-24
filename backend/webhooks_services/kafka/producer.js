import { Kafka, CompressionTypes, logLevel, Partitioners } from "kafkajs";
import crypto from "crypto";
import { v4 as uuidv4 } from "uuid";
import { CURRENT_SCHEMA_VERSION, normalizeSchemaVersion, validateEvent } from "./schema.js";

// ─── Config (all env-driven with safe defaults) ───────────────────────────────
const ENABLED = process.env.EVENT_LOGGING_ENABLED !== "false";
const BROKERS = (process.env.KAFKA_BROKERS || "localhost:9092").split(",");
const HAS_EXPLICIT_BROKERS = typeof process.env.KAFKA_BROKERS === "string" && process.env.KAFKA_BROKERS.trim().length > 0;
const CLIENT_ID = process.env.KAFKA_CLIENT_ID || "webhooks-service";
const TOPIC = process.env.KAFKA_TOPIC_EVENTS || "rec.events.v1";
const SSL = process.env.KAFKA_SSL === "true";
const SASL_MECHANISM = process.env.KAFKA_SASL_MECHANISM || null; // "plain" | "scram-sha-256" etc.
const SASL_USER = process.env.KAFKA_SASL_USERNAME || null;
const SASL_PASS = process.env.KAFKA_SASL_PASSWORD || null;
const CB_FAILURE_THRESHOLD = parseInt(process.env.KAFKA_CB_FAILURE_THRESHOLD || "5", 10);
const CB_WINDOW_MS = parseInt(process.env.KAFKA_CB_WINDOW_MS || "60000", 10);
const CB_COOLDOWN_MS = parseInt(process.env.KAFKA_CB_COOLDOWN_MS || "30000", 10);

// ─── Build KafkaJS client ─────────────────────────────────────────────────────
let kafka = null;
let producer = null;
let producerReady = false;
let warnedProducerNotReady = false;
const circuitBreaker = { failures: [], openUntil: 0 };

function cleanupFailures(now = Date.now()) {
  circuitBreaker.failures = circuitBreaker.failures.filter((ts) => now - ts <= CB_WINDOW_MS);
}

function isBreakerOpen(now = Date.now()) {
  return circuitBreaker.openUntil > now;
}

function recordBreakerFailure() {
  const now = Date.now();
  circuitBreaker.failures.push(now);
  cleanupFailures(now);
  if (circuitBreaker.failures.length >= CB_FAILURE_THRESHOLD) {
    circuitBreaker.openUntil = now + CB_COOLDOWN_MS;
    circuitBreaker.failures = [];
    console.warn(`[kafka/producer] Circuit breaker opened for ${CB_COOLDOWN_MS}ms`);
  }
}

function recordBreakerSuccess() {
  circuitBreaker.failures = [];
  circuitBreaker.openUntil = 0;
}

function buildKafkaClient() {
  const sasl =
    SASL_MECHANISM && SASL_USER && SASL_PASS
      ? { mechanism: SASL_MECHANISM, username: SASL_USER, password: SASL_PASS }
      : undefined;

  // Silence KafkaJS v2 partitioner warning in local/dev runs.
  process.env.KAFKAJS_NO_PARTITIONER_WARNING = "1";

  return new Kafka({
    clientId: CLIENT_ID,
    brokers: BROKERS,
    ssl: SSL || !!sasl,
    sasl,
    // Keep terminal output concise in dev and prod.
    logLevel: logLevel.WARN,
    // Fail fast instead of retry-spamming when broker is unavailable.
    retry: { retries: 0 },
  });
}

// ─── Lifecycle: connect ───────────────────────────────────────────────────────
/**
 * Call once at service startup (server.js).
 * Idempotent — safe to call multiple times.
 */
async function connectProducer() {
  if (!ENABLED) {
    console.info("[kafka/producer] EVENT_LOGGING_ENABLED=false — producer skipped");
    return;
  }
  if (!HAS_EXPLICIT_BROKERS) {
    console.info("[kafka/producer] KAFKA_BROKERS not set — skipping Kafka connection (set KAFKA_BROKERS to enable)");
    return;
  }
  if (producerReady) return;

  try {
    kafka = buildKafkaClient();
    producer = kafka.producer({
      createPartitioner: Partitioners.DefaultPartitioner,
      // Reliability: leader + all in-sync replicas must ack
      acks: -1, // acks=all
      // Bounded produce timeout (ms); prevents hanging requests
      timeout: parseInt(process.env.KAFKA_PRODUCE_TIMEOUT_MS || "5000", 10),
      // Retry up to N times with exponential backoff before giving up
      retry: {
        retries: parseInt(process.env.KAFKA_PRODUCER_RETRIES || "3", 10),
        initialRetryTime: 300,
        factor: 2,
      },
      // Idempotent producer: exactly-once delivery to broker
      idempotent: true,
    });

    await producer.connect();
    producerReady = true;
    warnedProducerNotReady = false;
    console.info("[kafka/producer] Connected to brokers:", BROKERS.join(", "));
  } catch (err) {
    // Non-fatal: service starts without Kafka; emitEvent() will warn per call
    console.warn("[kafka/producer] Startup connect failed — running without Kafka:", err.message);
    producerReady = false;
  }
}

// ─── Lifecycle: disconnect ────────────────────────────────────────────────────
/**
 * Call on SIGTERM / SIGINT in server.js for graceful shutdown.
 */
async function disconnectProducer() {
  if (producer && producerReady) {
    try {
      await producer.disconnect();
      producerReady = false;
      console.info("[kafka/producer] Producer disconnected gracefully");
    } catch (err) {
      console.warn("[kafka/producer] Error during disconnect:", err.message);
    }
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
/**
 * SHA-256 hash of raw API key — never persist the raw value.
 * Returns null if input is falsy.
 */
function hashApiKey(rawKey) {
  if (!rawKey) return null;
  return crypto.createHash("sha256").update(rawKey).digest("hex");
}

/**
 * Message key strategy (per spec):
 *   project_id → app_name → event_id (fallback)
 */
function resolveMessageKey(payload) {
  return String(payload.project_id || payload.app_name || payload.event_id);
}

// ─── Core: emitEvent ─────────────────────────────────────────────────────────
/**
 * Enrich, validate, and produce one event to Kafka.
 *
 * @param {object} partial   Caller-supplied fields (see schema.js for full contract)
 * @param {object} [opts]
 * @param {boolean} [opts.throwOnValidation=false]
 *    true  → throw on JSON-schema violation (used by click/rating endpoints)
 *    false → log + return null silently (used by recommendation paths)
 *
 * @returns {Promise<string|null>}  event_id on success, null on skip/failure
 */
async function emitEvent(partial, { throwOnValidation = false } = {}) {
  if (!ENABLED) return null;
  if (isBreakerOpen()) {
    console.warn("[kafka/producer] Circuit breaker open — dropping event", {
      event_type: partial.event_type,
      api_route: partial.api_route,
    });
    return null;
  }

  // ── 1. Enrich with required envelope fields ───────────────────────────────
  const schemaVersion = normalizeSchemaVersion(partial.schema_version) || CURRENT_SCHEMA_VERSION;
  const dwellMs = partial.dwell_time_ms ?? (partial.dwell_time_seconds != null ? Math.round(Number(partial.dwell_time_seconds) * 1000) : null);
  const event = {
    event_id: partial.event_id || uuidv4(),
    event_type: partial.event_type,
    schema_version: schemaVersion,
    occurred_at: partial.occurred_at || new Date().toISOString(),
    source_service: partial.source_service || "webhooks-service",
    api_route: partial.api_route || null,
    project_id: partial.project_id || null,
    user_id: partial.user_id || null,
    app_name: partial.app_name || null,
    api_key_hash: hashApiKey(partial._raw_api_key) || partial.api_key_hash || null,
    session_id: partial.session_id || null,
    correlation_id: partial.correlation_id || null,
    item_id: partial.item_id || null,
    item_title: partial.item_title || null,
    rating_value: partial.rating_value ?? null,
    dwell_time_ms: Number.isFinite(dwellMs) ? dwellMs : null,
    recommendation_count: partial.recommendation_count ?? null,
    recommendations_preview: partial.recommendations_preview || null,
    metadata: partial.metadata || {},
  };
  // Never leak the raw key downstream
  delete event._raw_api_key;

  // ── 2. Schema validation ──────────────────────────────────────────────────
  const validationError = validateEvent(event);
  if (validationError) {
    if (throwOnValidation) throw Object.assign(new Error(validationError), { status: 400 });
    console.warn("[kafka/producer] Invalid event payload — skipping produce:", validationError, {
      event_id: event.event_id,
      event_type: event.event_type,
    });
    return null;
  }

  // ── 3. Produce (safe-failure) ─────────────────────────────────────────────
  if (!producerReady) {
    if (!warnedProducerNotReady) {
      console.warn("[kafka/producer] Producer not ready — event logging is currently skipped");
      warnedProducerNotReady = true;
    }
    return null;
  }

  try {
    await producer.send({
      topic: TOPIC,
      compression: CompressionTypes.GZIP,
      messages: [
        {
          key: resolveMessageKey(event),
          value: JSON.stringify(event),
          headers: {
            "event-type": event.event_type,
            "source-service": event.source_service,
          },
        },
      ],
    });
    recordBreakerSuccess();
    return event.event_id;
  } catch (err) {
    recordBreakerFailure();
    // Structured warning — never rethrow (caller must not fail because of logging)
    console.warn("[kafka/producer] Produce failed — event dropped", {
      event_id: event.event_id,
      event_type: event.event_type,
      api_route: event.api_route,
      error: err.message,
    });
    return null;
  }
}

export { connectProducer, disconnectProducer, emitEvent, hashApiKey };