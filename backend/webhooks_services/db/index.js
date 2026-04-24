import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema.js";

// Trim in case .env has Windows CRLF or trailing space (invalid hostname → ENOTFOUND)
let connectionString = (process.env.DATABASE_URL || "postgresql://localhost:5432/neondb").trim();
if (connectionString.includes("sslmode=require") && !connectionString.includes("sslmode=verify-full")) {
  connectionString = connectionString.replace(/sslmode=require/g, "sslmode=verify-full");
}
const pool = new Pool({ connectionString });

export const db = drizzle(pool, { schema });

const ready = (async () => {
  const client = await pool.connect();
  try {
    await client.query("CREATE SCHEMA IF NOT EXISTS webhooks;");
    await client.query(`
      CREATE TABLE IF NOT EXISTS webhooks.apps (
        id SERIAL PRIMARY KEY,
        app_name TEXT,
        webhook_url TEXT,
        api_key TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS webhooks.usage (
        id SERIAL PRIMARY KEY,
        app_name TEXT UNIQUE,
        usage_count INTEGER DEFAULT 0
      );
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS webhooks.event_logs (
        event_id UUID PRIMARY KEY,
        event_type VARCHAR(64) NOT NULL,
        schema_version INTEGER NOT NULL DEFAULT 1,
        occurred_at TIMESTAMPTZ NOT NULL,
        source_service VARCHAR(128) NOT NULL,
        api_route VARCHAR(256),
        project_id INTEGER,
        user_id VARCHAR(255),
        app_name VARCHAR(255),
        api_key_hash CHAR(64),
        session_id VARCHAR(255),
        correlation_id VARCHAR(255),
        item_id VARCHAR(255),
        item_title VARCHAR(512),
        rating_value NUMERIC(5,2),
        dwell_time_ms INTEGER,
        recommendation_count INTEGER,
        recommendations_preview JSONB,
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        inserted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS webhooks.feature_summaries (
        subject_type VARCHAR(32) NOT NULL,
        subject_id VARCHAR(255) NOT NULL,
        schema_version INTEGER NOT NULL DEFAULT 1,
        event_count INTEGER NOT NULL DEFAULT 0,
        click_count INTEGER NOT NULL DEFAULT 0,
        rating_count INTEGER NOT NULL DEFAULT 0,
        skip_count INTEGER NOT NULL DEFAULT 0,
        dwell_count INTEGER NOT NULL DEFAULT 0,
        served_count INTEGER NOT NULL DEFAULT 0,
        rating_sum NUMERIC(12,2) NOT NULL DEFAULT 0,
        dwell_sum_ms INTEGER NOT NULL DEFAULT 0,
        avg_rating NUMERIC(12,2),
        last_event_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (subject_type, subject_id)
      );
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS webhooks.event_windows (
        subject_type VARCHAR(32) NOT NULL,
        subject_id VARCHAR(255) NOT NULL,
        window_start TIMESTAMPTZ NOT NULL,
        schema_version INTEGER NOT NULL DEFAULT 1,
        event_count INTEGER NOT NULL DEFAULT 0,
        click_count INTEGER NOT NULL DEFAULT 0,
        rating_count INTEGER NOT NULL DEFAULT 0,
        skip_count INTEGER NOT NULL DEFAULT 0,
        dwell_count INTEGER NOT NULL DEFAULT 0,
        served_count INTEGER NOT NULL DEFAULT 0,
        rating_sum NUMERIC(12,2) NOT NULL DEFAULT 0,
        dwell_sum_ms INTEGER NOT NULL DEFAULT 0,
        anomaly_score NUMERIC(12,2),
        last_event_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (subject_type, subject_id, window_start)
      );
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS webhooks.retrain_state (
        project_id INTEGER PRIMARY KEY,
        feedback_count INTEGER NOT NULL DEFAULT 0,
        window_started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        last_triggered_at TIMESTAMPTZ,
        cooldown_until TIMESTAMPTZ,
        trigger_count INTEGER NOT NULL DEFAULT 0,
        last_event_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_event_logs_type_time
      ON webhooks.event_logs (event_type, occurred_at DESC);
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_event_logs_project_time
      ON webhooks.event_logs (project_id, occurred_at DESC)
      WHERE project_id IS NOT NULL;
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_event_logs_app_time
      ON webhooks.event_logs (app_name, occurred_at DESC)
      WHERE app_name IS NOT NULL;
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_event_windows_dim_time
      ON webhooks.event_windows (subject_type, subject_id, window_start DESC);
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_feature_summaries_last_event
      ON webhooks.feature_summaries (subject_type, subject_id, last_event_at DESC);
    `);
    console.log("✅ PostgreSQL ready: schema webhooks (tables apps, usage, event_logs, feature_summaries, event_windows, retrain_state)");
  } finally {
    client.release();
  }
  return pool;
})();

export { ready };
