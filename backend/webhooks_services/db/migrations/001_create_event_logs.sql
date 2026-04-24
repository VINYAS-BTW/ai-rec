
CREATE SCHEMA IF NOT EXISTS webhooks;

CREATE TABLE IF NOT EXISTS webhooks.event_logs (
    -- ── Envelope ──────────────────────────────────────────────────────────
    event_id              UUID        PRIMARY KEY,          -- idempotency key
    event_type            VARCHAR(64) NOT NULL,             -- click | rating | recommendation_served
    schema_version        INTEGER     NOT NULL DEFAULT 1,
    occurred_at           TIMESTAMPTZ NOT NULL,
    source_service        VARCHAR(128) NOT NULL,
    api_route             VARCHAR(256),

    -- ── Identity ──────────────────────────────────────────────────────────
    project_id            INTEGER,
    user_id               VARCHAR(255),
    app_name              VARCHAR(255),
    api_key_hash          CHAR(64),                         -- sha256 hex; raw key is NEVER stored
    session_id            VARCHAR(255),
    correlation_id        VARCHAR(255),

    -- ── Event-specific payload ────────────────────────────────────────────
    item_id               VARCHAR(255),
    item_title            VARCHAR(512),
    rating_value          NUMERIC(5,2),
    dwell_time_ms         INTEGER,
    recommendation_count  INTEGER,
    recommendations_preview JSONB,

    -- ── Freeform metadata ─────────────────────────────────────────────────
    metadata              JSONB        NOT NULL DEFAULT '{}',

    -- ── Audit ─────────────────────────────────────────────────────────────
    inserted_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_event_logs_type_time
    ON webhooks.event_logs (event_type, occurred_at DESC);

-- Query patterns: per-project event timeline
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_event_logs_project_time
    ON webhooks.event_logs (project_id, occurred_at DESC)
    WHERE project_id IS NOT NULL;

-- Query patterns: per-app event timeline
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_event_logs_app_time
    ON webhooks.event_logs (app_name, occurred_at DESC)
    WHERE app_name IS NOT NULL;

-- Optional: check constraint enforces valid event types at DB level
ALTER TABLE webhooks.event_logs
    DROP CONSTRAINT IF EXISTS chk_event_type;
ALTER TABLE webhooks.event_logs
    ADD CONSTRAINT chk_event_type
    CHECK (event_type IN ('click', 'rating', 'skip', 'dwell', 'recommendation_served'));

CREATE TABLE IF NOT EXISTS webhooks.feature_summaries (
    subject_type   VARCHAR(32)  NOT NULL,
    subject_id     VARCHAR(255) NOT NULL,
    schema_version INTEGER      NOT NULL DEFAULT 1,
    event_count    INTEGER      NOT NULL DEFAULT 0,
    click_count    INTEGER      NOT NULL DEFAULT 0,
    rating_count   INTEGER      NOT NULL DEFAULT 0,
    skip_count     INTEGER      NOT NULL DEFAULT 0,
    dwell_count    INTEGER      NOT NULL DEFAULT 0,
    served_count   INTEGER      NOT NULL DEFAULT 0,
    rating_sum     NUMERIC(12,2) NOT NULL DEFAULT 0,
    dwell_sum_ms   INTEGER      NOT NULL DEFAULT 0,
    avg_rating     NUMERIC(12,2),
    last_event_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    PRIMARY KEY (subject_type, subject_id)
);

CREATE TABLE IF NOT EXISTS webhooks.event_windows (
    subject_type   VARCHAR(32)  NOT NULL,
    subject_id     VARCHAR(255) NOT NULL,
    window_start   TIMESTAMPTZ  NOT NULL,
    schema_version INTEGER      NOT NULL DEFAULT 1,
    event_count    INTEGER      NOT NULL DEFAULT 0,
    click_count    INTEGER      NOT NULL DEFAULT 0,
    rating_count   INTEGER      NOT NULL DEFAULT 0,
    skip_count     INTEGER      NOT NULL DEFAULT 0,
    dwell_count    INTEGER      NOT NULL DEFAULT 0,
    served_count   INTEGER      NOT NULL DEFAULT 0,
    rating_sum     NUMERIC(12,2) NOT NULL DEFAULT 0,
    dwell_sum_ms   INTEGER      NOT NULL DEFAULT 0,
    anomaly_score  NUMERIC(12,2),
    last_event_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    PRIMARY KEY (subject_type, subject_id, window_start)
);

CREATE TABLE IF NOT EXISTS webhooks.retrain_state (
    project_id         INTEGER PRIMARY KEY,
    feedback_count     INTEGER      NOT NULL DEFAULT 0,
    window_started_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    last_triggered_at  TIMESTAMPTZ,
    cooldown_until     TIMESTAMPTZ,
    trigger_count      INTEGER      NOT NULL DEFAULT 0,
    last_event_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_event_windows_dim_time
    ON webhooks.event_windows (subject_type, subject_id, window_start DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_feature_summaries_last_event
    ON webhooks.feature_summaries (subject_type, subject_id, last_event_at DESC);