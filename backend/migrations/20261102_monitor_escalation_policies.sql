BEGIN;

ALTER TABLE monitor_alert_state
    ADD COLUMN IF NOT EXISTS outage_started_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS escalation_stage SMALLINT NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS escalation_paused_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS escalation_paused_seconds INTEGER NOT NULL DEFAULT 0;

DO $migration$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'monitor_alert_state_escalation_stage_check'
          AND conrelid = 'public.monitor_alert_state'::regclass
    ) THEN
        ALTER TABLE monitor_alert_state
            ADD CONSTRAINT monitor_alert_state_escalation_stage_check
            CHECK (escalation_stage BETWEEN 0 AND 5);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'monitor_alert_state_escalation_paused_seconds_check'
          AND conrelid = 'public.monitor_alert_state'::regclass
    ) THEN
        ALTER TABLE monitor_alert_state
            ADD CONSTRAINT monitor_alert_state_escalation_paused_seconds_check
            CHECK (escalation_paused_seconds >= 0);
    END IF;
END
$migration$;

CREATE TABLE IF NOT EXISTS monitor_escalation_stages (
    id BIGSERIAL PRIMARY KEY,
    monitor_id INTEGER NOT NULL
        REFERENCES monitors(id) ON DELETE CASCADE,
    stage_number SMALLINT NOT NULL
        CHECK (stage_number BETWEEN 1 AND 5),
    delay_minutes INTEGER NOT NULL
        CHECK (delay_minutes BETWEEN 1 AND 10080),
    routing_mode VARCHAR(10) NOT NULL DEFAULT 'ALL'
        CHECK (routing_mode IN ('ALL', 'SELECTED')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT monitor_escalation_stages_monitor_stage_unique
        UNIQUE (monitor_id, stage_number),
    CONSTRAINT monitor_escalation_stages_id_monitor_unique
        UNIQUE (id, monitor_id)
);

CREATE TABLE IF NOT EXISTS monitor_escalation_stage_channels (
    stage_id BIGINT NOT NULL
        REFERENCES monitor_escalation_stages(id) ON DELETE CASCADE,
    channel_id INTEGER NOT NULL
        REFERENCES notification_channels(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (stage_id, channel_id)
);

CREATE INDEX IF NOT EXISTS idx_monitor_escalation_stages_monitor
    ON monitor_escalation_stages (monitor_id, stage_number);

CREATE INDEX IF NOT EXISTS idx_monitor_escalation_stage_channels_channel
    ON monitor_escalation_stage_channels (channel_id);

COMMIT;
