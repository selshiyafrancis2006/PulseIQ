BEGIN;

ALTER TABLE monitors
    DROP CONSTRAINT IF EXISTS monitors_monitor_type_check;

ALTER TABLE monitors
    ADD CONSTRAINT monitors_monitor_type_check
    CHECK (monitor_type IN ('HTTP', 'TCP', 'DNS', 'HEARTBEAT'));

CREATE TABLE IF NOT EXISTS heartbeat_monitor_secrets (
    monitor_id INTEGER PRIMARY KEY
        REFERENCES monitors(id) ON DELETE CASCADE,
    token_hash CHAR(64) NOT NULL UNIQUE,
    last_seen_at TIMESTAMPTZ,
    CONSTRAINT heartbeat_token_hash_format
        CHECK (token_hash ~ '^[a-f0-9]{64}$')
);

CREATE INDEX IF NOT EXISTS idx_heartbeat_monitor_last_seen
    ON heartbeat_monitor_secrets (last_seen_at);

COMMIT;
