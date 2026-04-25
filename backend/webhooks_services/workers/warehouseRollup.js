import "../loadEnv.js";
import pkg from "pg";

const { Pool } = pkg;

const ROLLUP_LOOKBACK_HOURS = parseInt(process.env.WAREHOUSE_ROLLUP_LOOKBACK_HOURS || "48", 10);
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 3,
  idleTimeoutMillis: 30000,
});

async function runRollups() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    await client.query(
      `
      INSERT INTO webhooks.events_lake_hourly (
        bucket_hour, project_id, event_type, total_events, unique_users, avg_rating, total_dwell_ms
      )
      SELECT
        date_trunc('hour', occurred_at) AS bucket_hour,
        project_id,
        event_type,
        COUNT(*)::int AS total_events,
        COUNT(DISTINCT user_id)::int AS unique_users,
        AVG(rating_value)::numeric(12,2) AS avg_rating,
        COALESCE(SUM(dwell_time_ms), 0)::bigint AS total_dwell_ms
      FROM webhooks.event_logs
      WHERE occurred_at >= NOW() - ($1::text || ' hours')::interval
      GROUP BY 1,2,3
      ON CONFLICT (bucket_hour, project_id, event_type) DO UPDATE SET
        total_events = EXCLUDED.total_events,
        unique_users = EXCLUDED.unique_users,
        avg_rating = EXCLUDED.avg_rating,
        total_dwell_ms = EXCLUDED.total_dwell_ms,
        created_at = NOW();
      `,
      [String(ROLLUP_LOOKBACK_HOURS)],
    );

    await client.query(
      `
      INSERT INTO webhooks.analytics_project_daily (
        day_date, project_id, feedback_events, recommendation_events, unique_users,
        rating_events, avg_rating, negative_feedback_events, total_dwell_ms, retrain_triggers, updated_at
      )
      SELECT
        DATE(occurred_at) AS day_date,
        project_id,
        COUNT(*) FILTER (WHERE event_type IN ('click','rating','skip','dwell'))::int AS feedback_events,
        COUNT(*) FILTER (WHERE event_type = 'recommendation_served')::int AS recommendation_events,
        COUNT(DISTINCT user_id)::int AS unique_users,
        COUNT(*) FILTER (WHERE event_type = 'rating')::int AS rating_events,
        AVG(rating_value)::numeric(12,2) AS avg_rating,
        COUNT(*) FILTER (WHERE event_type = 'skip')::int AS negative_feedback_events,
        COALESCE(SUM(dwell_time_ms), 0)::bigint AS total_dwell_ms,
        (
          SELECT COUNT(*)::int
          FROM webhooks.retrain_audit ra
          WHERE ra.project_id = el.project_id
            AND DATE(ra.evaluated_at) = DATE(el.occurred_at)
            AND ra.triggered = TRUE
        ) AS retrain_triggers,
        NOW()
      FROM webhooks.event_logs el
      WHERE occurred_at >= NOW() - ($1::text || ' hours')::interval
        AND project_id IS NOT NULL
      GROUP BY 1,2
      ON CONFLICT (day_date, project_id) DO UPDATE SET
        feedback_events = EXCLUDED.feedback_events,
        recommendation_events = EXCLUDED.recommendation_events,
        unique_users = EXCLUDED.unique_users,
        rating_events = EXCLUDED.rating_events,
        avg_rating = EXCLUDED.avg_rating,
        negative_feedback_events = EXCLUDED.negative_feedback_events,
        total_dwell_ms = EXCLUDED.total_dwell_ms,
        retrain_triggers = EXCLUDED.retrain_triggers,
        updated_at = NOW();
      `,
      [String(ROLLUP_LOOKBACK_HOURS)],
    );

    await client.query("COMMIT");
    console.info("[warehouse-rollup] ETL rollups completed", { lookbackHours: ROLLUP_LOOKBACK_HOURS });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("[warehouse-rollup] ETL rollups failed", { error: err.message });
    throw err;
  } finally {
    client.release();
  }
}

runRollups()
  .then(async () => {
    await pool.end();
    process.exit(0);
  })
  .catch(async () => {
    await pool.end();
    process.exit(1);
  });
