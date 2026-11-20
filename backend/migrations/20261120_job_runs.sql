BEGIN;

CREATE TABLE IF NOT EXISTS job_runs (
    job_name TEXT PRIMARY KEY,
    last_success_at TIMESTAMPTZ,
    last_failure_at TIMESTAMPTZ,
    last_error TEXT,
    consecutive_failures INTEGER NOT NULL DEFAULT 0
);

COMMIT;