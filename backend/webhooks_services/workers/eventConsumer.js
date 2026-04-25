import "../loadEnv.js";
import { Kafka, CompressionTypes, logLevel } from "kafkajs";
import pkg from "pg";
import axios from "axios";
import { validateEvent } from "../kafka/schema.js";

const { Pool } = pkg;

// ─── Config ───────────────────────────────────────────────────────────────────
const BROKERS = (process.env.KAFKA_BROKERS || "localhost:9092").split(",");
const CLIENT_ID = (process.env.KAFKA_CLIENT_ID || "webhooks-service") + "-consumer";
const TOPIC = process.env.KAFKA_TOPIC_EVENTS || "rec.events.v1";
const DLQ_TOPIC = process.env.KAFKA_TOPIC_DLQ || "rec.events.dlq.v1";
const GROUP_ID = process.env.KAFKA_CONSUMER_GROUP || "rec-events-postgres-sink-v1";
const SSL = process.env.KAFKA_SSL === "true";
const SASL_MECHANISM = process.env.KAFKA_SASL_MECHANISM || null;
const SASL_USER = process.env.KAFKA_SASL_USERNAME || null;
const SASL_PASS = process.env.KAFKA_SASL_PASSWORD || null;
const ETL_RETRAIN_ENABLED = process.env.ETL_RETRAIN_ENABLED !== "false";
const ETL_RETRAIN_THRESHOLD = parseInt(process.env.ETL_RETRAIN_THRESHOLD || "50", 10);
const ETL_RETRAIN_WINDOW_MINUTES = parseInt(process.env.ETL_RETRAIN_WINDOW_MINUTES || "60", 10);
const ETL_RETRAIN_COOLDOWN_MINUTES = parseInt(process.env.ETL_RETRAIN_COOLDOWN_MINUTES || "180", 10);
const ETL_RETRAIN_MIN_RATINGS = parseInt(process.env.ETL_RETRAIN_MIN_RATINGS || "5", 10);
const ETL_RETRAIN_MIN_UNIQUE_USERS = parseInt(process.env.ETL_RETRAIN_MIN_UNIQUE_USERS || "5", 10);
const ETL_RETRAIN_MIN_NEGATIVE_FEEDBACK = parseInt(process.env.ETL_RETRAIN_MIN_NEGATIVE_FEEDBACK || "3", 10);
const ETL_RETRAIN_MAX_AVG_RATING = Number(process.env.ETL_RETRAIN_MAX_AVG_RATING || "4.7");
const BACK2_RETRAIN_URL = (process.env.BACK2_RETRAIN_URL || "http://localhost:8000").replace(/\/$/, "");
const BACK2_INTERNAL_KEY = process.env.BACK2_INTERNAL_KEY || "";
const STREAM_PROCESSOR_MODE = process.env.STREAM_PROCESSOR_MODE || "realtime-v2";
const PARTITIONS_CONSUMED_CONCURRENTLY = parseInt(process.env.KAFKA_PARTITIONS_CONSUMED_CONCURRENTLY || "3", 10);
const MAX_BATCH_MESSAGES = parseInt(process.env.KAFKA_MAX_BATCH_MESSAGES || "100", 10);
const LAG_WARN_THRESHOLD = parseInt(process.env.KAFKA_LAG_WARN_THRESHOLD || "1000", 10);

// ─── Postgres pool (reuses DATABASE_URL already used by webhooks service) ─────
const db = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 5,
  idleTimeoutMillis: 30000,
});

// ─── Kafka client ─────────────────────────────────────────────────────────────
const sasl =
  SASL_MECHANISM && SASL_USER && SASL_PASS
    ? { mechanism: SASL_MECHANISM, username: SASL_USER, password: SASL_PASS }
    : undefined;

const kafka = new Kafka({
  clientId: CLIENT_ID,
  brokers: BROKERS,
  ssl: SSL || !!sasl,
  sasl,
  logLevel: process.env.NODE_ENV === "production" ? logLevel.WARN : logLevel.INFO,
});

const consumer = kafka.consumer({
  groupId: GROUP_ID,
  // Don't auto-commit — we commit manually after DB write
  heartbeatInterval: 3000,
  sessionTimeout: 30000,
  retry: { retries: 5, initialRetryTime: 300, factor: 2 },
});

const dlqProducer = kafka.producer({ acks: 1 }); // best-effort for DLQ

// ─── DB: upsert event (idempotent by event_id) ────────────────────────────────
const UPSERT_EVENT_SQL = `
  INSERT INTO webhooks.event_logs (
    event_id, event_type, schema_version, occurred_at, source_service, api_route,
    project_id, user_id, app_name, api_key_hash, session_id,
    correlation_id, item_id, item_title, rating_value, dwell_time_ms,
    recommendation_count, recommendations_preview, metadata
  ) VALUES (
    $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19
  )
  ON CONFLICT (event_id) DO NOTHING
  RETURNING event_id;
`;

const UPSERT_FEATURE_SQL = `
  INSERT INTO webhooks.feature_summaries (
    subject_type, subject_id, schema_version,
    event_count, click_count, rating_count, skip_count, dwell_count, served_count,
    rating_sum, dwell_sum_ms, avg_rating, last_event_at
  ) VALUES (
    $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13
  )
  ON CONFLICT (subject_type, subject_id) DO UPDATE SET
    schema_version = GREATEST(webhooks.feature_summaries.schema_version, EXCLUDED.schema_version),
    event_count = webhooks.feature_summaries.event_count + EXCLUDED.event_count,
    click_count = webhooks.feature_summaries.click_count + EXCLUDED.click_count,
    rating_count = webhooks.feature_summaries.rating_count + EXCLUDED.rating_count,
    skip_count = webhooks.feature_summaries.skip_count + EXCLUDED.skip_count,
    dwell_count = webhooks.feature_summaries.dwell_count + EXCLUDED.dwell_count,
    served_count = webhooks.feature_summaries.served_count + EXCLUDED.served_count,
    rating_sum = webhooks.feature_summaries.rating_sum + EXCLUDED.rating_sum,
    dwell_sum_ms = webhooks.feature_summaries.dwell_sum_ms + EXCLUDED.dwell_sum_ms,
    avg_rating = CASE
      WHEN (webhooks.feature_summaries.rating_count + EXCLUDED.rating_count) > 0 THEN
        ROUND((webhooks.feature_summaries.rating_sum + EXCLUDED.rating_sum)::numeric / NULLIF(webhooks.feature_summaries.rating_count + EXCLUDED.rating_count, 0), 2)
      ELSE NULL
    END,
    last_event_at = EXCLUDED.last_event_at;
`;

const UPSERT_WINDOW_SQL = `
  INSERT INTO webhooks.event_windows (
    subject_type, subject_id, window_start, schema_version,
    event_count, click_count, rating_count, skip_count, dwell_count, served_count,
    rating_sum, dwell_sum_ms, anomaly_score, last_event_at
  ) VALUES (
    $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14
  )
  ON CONFLICT (subject_type, subject_id, window_start) DO UPDATE SET
    schema_version = GREATEST(webhooks.event_windows.schema_version, EXCLUDED.schema_version),
    event_count = webhooks.event_windows.event_count + EXCLUDED.event_count,
    click_count = webhooks.event_windows.click_count + EXCLUDED.click_count,
    rating_count = webhooks.event_windows.rating_count + EXCLUDED.rating_count,
    skip_count = webhooks.event_windows.skip_count + EXCLUDED.skip_count,
    dwell_count = webhooks.event_windows.dwell_count + EXCLUDED.dwell_count,
    served_count = webhooks.event_windows.served_count + EXCLUDED.served_count,
    rating_sum = webhooks.event_windows.rating_sum + EXCLUDED.rating_sum,
    dwell_sum_ms = webhooks.event_windows.dwell_sum_ms + EXCLUDED.dwell_sum_ms,
    last_event_at = EXCLUDED.last_event_at;
`;

function getWindowStart(occurredAt) {
  const ts = new Date(occurredAt);
  ts.setSeconds(0, 0);
  return ts;
}

function buildIncrement(event) {
  const increment = {
    event_count: 1,
    click_count: 0,
    rating_count: 0,
    skip_count: 0,
    dwell_count: 0,
    served_count: 0,
    rating_sum: 0,
    dwell_sum_ms: 0,
  };

  if (event.event_type === "click") increment.click_count = 1;
  if (event.event_type === "rating") {
    increment.rating_count = 1;
    increment.rating_sum = Number(event.rating_value || 0);
  }
  if (event.event_type === "skip") increment.skip_count = 1;
  if (event.event_type === "dwell") {
    increment.dwell_count = 1;
    increment.dwell_sum_ms = Number(event.dwell_time_ms || 0);
  }
  if (event.event_type === "recommendation_served") increment.served_count = 1;

  return increment;
}

function buildSubjects(event) {
  const subjects = [];
  if (event.event_type) subjects.push({ subject_type: "event_type", subject_id: String(event.event_type) });
  if (event.app_name) subjects.push({ subject_type: "app", subject_id: String(event.app_name) });
  if (event.project_id !== null && event.project_id !== undefined) subjects.push({ subject_type: "project", subject_id: String(event.project_id) });
  if (event.item_id) subjects.push({ subject_type: "item", subject_id: String(event.item_id) });
  if (event.user_id) subjects.push({ subject_type: "user", subject_id: String(event.user_id) });
  return subjects;
}

async function upsertFeatureSummary(client, event, subject) {
  const inc = buildIncrement(event);
  const now = event.occurred_at;
  await client.query(UPSERT_FEATURE_SQL, [
    subject.subject_type,
    subject.subject_id,
    event.schema_version || 1,
    inc.event_count,
    inc.click_count,
    inc.rating_count,
    inc.skip_count,
    inc.dwell_count,
    inc.served_count,
    inc.rating_sum,
    inc.dwell_sum_ms,
    inc.rating_count > 0 ? Number((Number(inc.rating_sum) / inc.rating_count).toFixed(2)) : null,
    now,
  ]);
}

async function upsertWindowSummary(client, event, subject, windowStart) {
  const inc = buildIncrement(event);
  await client.query(UPSERT_WINDOW_SQL, [
    subject.subject_type,
    subject.subject_id,
    windowStart,
    event.schema_version || 1,
    inc.event_count,
    inc.click_count,
    inc.rating_count,
    inc.skip_count,
    inc.dwell_count,
    inc.served_count,
    inc.rating_sum,
    inc.dwell_sum_ms,
    null,
    event.occurred_at,
  ]);

  const historyRes = await client.query(
    `SELECT event_count FROM webhooks.event_windows WHERE subject_type = $1 AND subject_id = $2 AND window_start < $3 ORDER BY window_start DESC LIMIT 5;`,
    [subject.subject_type, subject.subject_id, windowStart],
  );
  const currentRes = await client.query(
    `SELECT event_count FROM webhooks.event_windows WHERE subject_type = $1 AND subject_id = $2 AND window_start = $3 LIMIT 1;`,
    [subject.subject_type, subject.subject_id, windowStart],
  );
  const currentCount = Number(currentRes.rows[0]?.event_count || 0);
  const history = historyRes.rows.map((row) => Number(row.event_count || 0));
  const avg = history.length ? history.reduce((sum, value) => sum + value, 0) / history.length : 0;
  const anomalyScore = avg > 0 && currentCount >= Math.max(10, avg * 3) ? Number((currentCount / avg).toFixed(2)) : null;

  await client.query(
    `UPDATE webhooks.event_windows SET anomaly_score = $4 WHERE subject_type = $1 AND subject_id = $2 AND window_start = $3;`,
    [subject.subject_type, subject.subject_id, windowStart, anomalyScore],
  );
}

async function updateRollups(client, event) {
  const subjects = buildSubjects(event);
  const windowStart = getWindowStart(event.occurred_at);
  for (const subject of subjects) {
    await upsertFeatureSummary(client, event, subject);
    await upsertWindowSummary(client, event, subject, windowStart);
  }
}

async function maybeTriggerRetrain(client, event) {
  if (!ETL_RETRAIN_ENABLED) {
    return false;
  }
  if (!event.project_id) {
    return false;
  }
  if (!(["click", "rating", "skip", "dwell"].includes(event.event_type))) {
    return false;
  }

  const now = new Date();

  const existing = await client.query(
    `SELECT * FROM webhooks.retrain_state WHERE project_id = $1 LIMIT 1;`,
    [event.project_id],
  );
  const state = existing.rows[0] || null;
  const cooldownUntil = state?.cooldown_until ? new Date(state.cooldown_until) : null;
  if (cooldownUntil && cooldownUntil > now) {
    return false;
  }

  let feedbackCount = 1;
  let windowStartValue = now;
  if (state?.window_started_at) {
    const storedWindowStart = new Date(state.window_started_at);
    const isWindowExpired = (now - storedWindowStart) > ETL_RETRAIN_WINDOW_MINUTES * 60 * 1000;
    windowStartValue = isWindowExpired ? now : storedWindowStart;
    feedbackCount = isWindowExpired ? 1 : Number(state.feedback_count || 0) + 1;
  }

  const windowStartTs = windowStartValue.toISOString();
  const qualityGateRes = await client.query(
    `
      SELECT
        COUNT(*)::int AS feedback_events,
        COUNT(DISTINCT user_id)::int AS unique_users,
        COUNT(*) FILTER (WHERE event_type = 'rating')::int AS rating_events,
        COUNT(*) FILTER (WHERE event_type IN ('skip'))::int AS negative_events,
        AVG(rating_value)::numeric AS avg_rating
      FROM webhooks.event_logs
      WHERE project_id = $1
        AND occurred_at >= $2::timestamptz
        AND event_type IN ('click', 'rating', 'skip', 'dwell');
    `,
    [event.project_id, windowStartTs],
  );
  const gates = qualityGateRes.rows[0] || {};
  const gateFeedbackEvents = Number(gates.feedback_events || 0);
  const gateUniqueUsers = Number(gates.unique_users || 0);
  const gateRatings = Number(gates.rating_events || 0);
  const gateNegative = Number(gates.negative_events || 0);
  const gateAvgRating = gates.avg_rating == null ? null : Number(gates.avg_rating);
  const qualityGatePass =
    gateFeedbackEvents >= ETL_RETRAIN_THRESHOLD &&
    gateUniqueUsers >= ETL_RETRAIN_MIN_UNIQUE_USERS &&
    gateRatings >= ETL_RETRAIN_MIN_RATINGS &&
    gateNegative >= ETL_RETRAIN_MIN_NEGATIVE_FEEDBACK &&
    (gateAvgRating == null || gateAvgRating <= ETL_RETRAIN_MAX_AVG_RATING);

  const shouldTrigger = feedbackCount >= ETL_RETRAIN_THRESHOLD && qualityGatePass;
  const nextCooldownUntil = shouldTrigger ? new Date(now.getTime() + ETL_RETRAIN_COOLDOWN_MINUTES * 60 * 1000) : cooldownUntil;

  await client.query(
    `
      INSERT INTO webhooks.retrain_state (
        project_id, feedback_count, window_started_at, last_triggered_at, cooldown_until, trigger_count, last_event_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7)
      ON CONFLICT (project_id) DO UPDATE SET
        feedback_count = EXCLUDED.feedback_count,
        window_started_at = EXCLUDED.window_started_at,
        last_triggered_at = EXCLUDED.last_triggered_at,
        cooldown_until = EXCLUDED.cooldown_until,
        trigger_count = EXCLUDED.trigger_count,
        last_event_at = EXCLUDED.last_event_at;
    `,
    [
      event.project_id,
      shouldTrigger ? 0 : feedbackCount,
      windowStartValue,
      shouldTrigger ? now : state?.last_triggered_at || null,
      shouldTrigger ? nextCooldownUntil : nextCooldownUntil,
      shouldTrigger ? Number(state?.trigger_count || 0) + 1 : Number(state?.trigger_count || 0),
      now,
    ],
  );

  await client.query(
    `
      INSERT INTO webhooks.retrain_audit (
        project_id, evaluated_at, window_started_at, feedback_count_in_state,
        gate_feedback_events, gate_unique_users, gate_rating_events, gate_negative_events, gate_avg_rating,
        quality_gate_pass, threshold_pass, triggered
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12);
    `,
    [
      event.project_id,
      now,
      windowStartValue,
      feedbackCount,
      gateFeedbackEvents,
      gateUniqueUsers,
      gateRatings,
      gateNegative,
      gateAvgRating,
      qualityGatePass,
      feedbackCount >= ETL_RETRAIN_THRESHOLD,
      shouldTrigger,
    ],
  );

  return shouldTrigger;
}

async function triggerRetrain(projectId) {
  if (!projectId || !ETL_RETRAIN_ENABLED) return;
  if (!BACK2_INTERNAL_KEY) {
    console.warn("[consumer] BACK2_INTERNAL_KEY not set — retrain trigger skipped", { projectId });
    return;
  }
  try {
    await axios.post(
      `${BACK2_RETRAIN_URL}/project/${projectId}/retrain`,
      {},
      { headers: { "X-Internal-Key": BACK2_INTERNAL_KEY }, timeout: 10000 },
    );
    console.info("[consumer] Retrain triggered", { projectId });
  } catch (err) {
    console.warn("[consumer] Retrain trigger failed", { projectId, error: err.message });
  }
}

async function withTransaction(fn) {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

async function persistEvent(client, event) {
  const res = await client.query(UPSERT_EVENT_SQL, [
    event.event_id,
    event.event_type,
    event.schema_version || 1,
    event.occurred_at,
    event.source_service,
    event.api_route,
    event.project_id,
    event.user_id,
    event.app_name,
    event.api_key_hash,
    event.session_id,
    event.correlation_id,
    event.item_id,
    event.item_title,
    event.rating_value,
    event.dwell_time_ms,
    event.recommendation_count,
    event.recommendations_preview ? JSON.stringify(event.recommendations_preview) : null,
    event.metadata ? JSON.stringify(event.metadata) : "{}",
  ]);
  return (res.rowCount || 0) > 0;
}

// ─── DLQ: dead-letter a bad record ───────────────────────────────────────────
async function sendToDLQ(rawValue, errorMessage, topic, partition, offset) {
  try {
    await dlqProducer.send({
      topic: DLQ_TOPIC,
      compression: CompressionTypes.GZIP,
      messages: [
        {
          value: JSON.stringify({
            original_payload: rawValue,
            error: errorMessage,
            failed_topic: topic,
            failed_partition: partition,
            failed_offset: offset,
            failed_at: new Date().toISOString(),
          }),
        },
      ],
    });
    console.warn("[consumer] Record sent to DLQ", { topic, partition, offset, error: errorMessage });
  } catch (dlqErr) {
    
    console.error("[consumer] DLQ write failed — skipping record", { error: dlqErr.message });
  }
}

async function processMessage(topic, partition, message) {
  const rawValue = message.value?.toString();
  let event;
  let shouldTriggerRetrain = false;

  // ── Parse ─────────────────────────────────────────────────────────────
  try {
    event = JSON.parse(rawValue);
  } catch (parseErr) {
    console.error("[realtime-processor] Unparseable message — DLQ", { partition, offset: message.offset });
    await sendToDLQ(rawValue, "JSON parse error: " + parseErr.message, topic, partition, message.offset);
    return { success: true, shouldTriggerRetrain: false, projectId: null };
  }

  // ── Validate ──────────────────────────────────────────────────────────
  const validationError = validateEvent(event);
  if (validationError) {
    console.warn("[realtime-processor] Validation failed — DLQ", { event_id: event.event_id, error: validationError });
    await sendToDLQ(rawValue, "Validation: " + validationError, topic, partition, message.offset);
    return { success: true, shouldTriggerRetrain: false, projectId: null };
  }

  // ── Persist + rollups (transactional) ─────────────────────────────────
  shouldTriggerRetrain = await withTransaction(async (client) => {
    const inserted = await persistEvent(client, event);
    if (!inserted) {
      return false;
    }

    await updateRollups(client, event);
    return await maybeTriggerRetrain(client, event);
  });

  return {
    success: true,
    shouldTriggerRetrain,
    projectId: event.project_id || null,
  };
}

// ─── Main consumer loop ───────────────────────────────────────────────────────
async function run() {
  console.info("[realtime-processor] Kafka startup config", {
    brokers: BROKERS,
    topic: TOPIC,
    dlqTopic: DLQ_TOPIC,
    groupId: GROUP_ID,
    streamMode: STREAM_PROCESSOR_MODE,
    partitionsConsumedConcurrently: PARTITIONS_CONSUMED_CONCURRENTLY,
    maxBatchMessages: MAX_BATCH_MESSAGES,
    lagWarnThreshold: LAG_WARN_THRESHOLD,
    saslUser: SASL_USER || null,
    saslMechanism: SASL_MECHANISM || null,
    ssl: SSL || !!sasl,
  });

  await dlqProducer.connect();
  await consumer.connect();
  await consumer.subscribe({ topic: TOPIC, fromBeginning: false });

  console.info("[realtime-processor] Subscribed to topic:", TOPIC, "| group:", GROUP_ID);

  await consumer.run({
    autoCommit: false,
    eachBatchAutoResolve: false,
    partitionsConsumedConcurrently: PARTITIONS_CONSUMED_CONCURRENTLY,
    eachBatch: async ({ batch, resolveOffset, heartbeat, isRunning, isStale, commitOffsetsIfNecessary }) => {
      const highWatermark = Number(batch.highWatermark || 0);
      const messages = batch.messages.slice(0, MAX_BATCH_MESSAGES);

      for (const message of messages) {
        if (!isRunning() || isStale()) {
          break;
        }

        const offsetToCommit = String(Number(message.offset) + 1);

        try {
          const result = await processMessage(batch.topic, batch.partition, message);

          // Commit after successful parse/validate/persist-or-DLQ handling.
          await consumer.commitOffsets([{ topic: batch.topic, partition: batch.partition, offset: offsetToCommit }]);
          resolveOffset(message.offset);

          if (result.shouldTriggerRetrain && result.projectId) {
            triggerRetrain(result.projectId);
          }
        } catch (dbErr) {
          console.error("[realtime-processor] DB write failed — message will be retried", {
            partition: batch.partition,
            offset: message.offset,
            error: dbErr.message,
          });
          throw dbErr;
        }

        const committedOffset = Number(offsetToCommit);
        const lag = highWatermark > committedOffset ? highWatermark - committedOffset : 0;
        if (lag >= LAG_WARN_THRESHOLD) {
          console.warn("[realtime-processor] Consumer lag threshold exceeded", {
            topic: batch.topic,
            partition: batch.partition,
            lag,
            highWatermark,
            committedOffset,
          });
        }

        await heartbeat();
      }

      await commitOffsetsIfNecessary();
    },
  });
}

// ─── Graceful shutdown ────────────────────────────────────────────────────────
let shuttingDown = false;

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.info(`[realtime-processor] ${signal} received — shutting down gracefully`);
  try {
    await consumer.disconnect();
    await dlqProducer.disconnect();
    await db.end();
    console.info("[realtime-processor] Clean shutdown complete");
    process.exit(0);
  } catch (err) {
    console.error("[realtime-processor] Error during shutdown:", err.message);
    process.exit(1);
  }
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT",  () => shutdown("SIGINT"));

// ─── Boot ─────────────────────────────────────────────────────────────────────
run().catch((err) => {
  console.error("[realtime-processor] Fatal startup error:", err.message);
  process.exit(1);
});

