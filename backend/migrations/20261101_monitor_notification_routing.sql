BEGIN;

CREATE TABLE IF NOT EXISTS monitor_notification_settings (
    monitor_id INTEGER PRIMARY KEY
        REFERENCES monitors(id) ON DELETE CASCADE,
    routing_mode VARCHAR(10) NOT NULL DEFAULT 'ALL'
        CHECK (routing_mode IN ('ALL', 'SELECTED')),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS monitor_notification_channels (
    monitor_id INTEGER NOT NULL
        REFERENCES monitors(id) ON DELETE CASCADE,
    channel_id INTEGER NOT NULL
        REFERENCES notification_channels(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (monitor_id, channel_id)
);

CREATE INDEX IF NOT EXISTS idx_monitor_notification_channels_channel
    ON monitor_notification_channels (channel_id);

COMMIT;
