BEGIN;

-- Track certificate warning progress independently of outage alerts.
CREATE TABLE IF NOT EXISTS monitor_certificate_alert_state (
    monitor_id INTEGER PRIMARY KEY
        REFERENCES monitors(id) ON DELETE CASCADE,
    certificate_expires_at TIMESTAMPTZ,
    last_alert_level SMALLINT NOT NULL DEFAULT 0
        CHECK (last_alert_level BETWEEN 0 AND 4),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMIT;
