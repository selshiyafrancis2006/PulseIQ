BEGIN;

CREATE TABLE IF NOT EXISTS metric_rollup_alert_state (
    job_name TEXT PRIMARY KEY,
    is_stale BOOLEAN NOT NULL DEFAULT FALSE,
    pending_event JSONB,
    last_transition_at TIMESTAMPTZ,
    last_notified_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMIT;
