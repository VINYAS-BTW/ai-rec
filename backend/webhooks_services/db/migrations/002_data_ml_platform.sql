CREATE TABLE IF NOT EXISTS webhooks.retrain_audit (
    id                      BIGSERIAL PRIMARY KEY,
    project_id              INTEGER NOT NULL,
    evaluated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    window_started_at       TIMESTAMPTZ NOT NULL,
    feedback_count_in_state INTEGER NOT NULL DEFAULT 0,
    gate_feedback_events    INTEGER NOT NULL DEFAULT 0,
    gate_unique_users       INTEGER NOT NULL DEFAULT 0,
    gate_rating_events      INTEGER NOT NULL DEFAULT 0,
    gate_negative_events    INTEGER NOT NULL DEFAULT 0,
    gate_avg_rating         NUMERIC(12,2),
    quality_gate_pass       BOOLEAN NOT NULL DEFAULT FALSE,
    threshold_pass          BOOLEAN NOT NULL DEFAULT FALSE,
    triggered               BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS idx_retrain_audit_project_time
    ON webhooks.retrain_audit (project_id, evaluated_at DESC);

CREATE TABLE IF NOT EXISTS webhooks.events_lake_hourly (
    bucket_hour         TIMESTAMPTZ NOT NULL,
    project_id          INTEGER,
    event_type          VARCHAR(64) NOT NULL,
    total_events        INTEGER NOT NULL DEFAULT 0,
    unique_users        INTEGER NOT NULL DEFAULT 0,
    avg_rating          NUMERIC(12,2),
    total_dwell_ms      BIGINT NOT NULL DEFAULT 0,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (bucket_hour, project_id, event_type)
);

CREATE TABLE IF NOT EXISTS webhooks.analytics_project_daily (
    day_date                DATE NOT NULL,
    project_id              INTEGER NOT NULL,
    feedback_events         INTEGER NOT NULL DEFAULT 0,
    recommendation_events   INTEGER NOT NULL DEFAULT 0,
    unique_users            INTEGER NOT NULL DEFAULT 0,
    rating_events           INTEGER NOT NULL DEFAULT 0,
    avg_rating              NUMERIC(12,2),
    negative_feedback_events INTEGER NOT NULL DEFAULT 0,
    total_dwell_ms          BIGINT NOT NULL DEFAULT 0,
    retrain_triggers        INTEGER NOT NULL DEFAULT 0,
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (day_date, project_id)
);

CREATE INDEX IF NOT EXISTS idx_analytics_project_daily_project_day
    ON webhooks.analytics_project_daily (project_id, day_date DESC);
