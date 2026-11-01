BEGIN;

ALTER TABLE monitors
    ADD COLUMN IF NOT EXISTS heartbeat_grace_seconds INTEGER NOT NULL DEFAULT 60;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'monitors_heartbeat_grace_seconds_check'
          AND conrelid = 'monitors'::regclass
    ) THEN
        ALTER TABLE monitors
            ADD CONSTRAINT monitors_heartbeat_grace_seconds_check
            CHECK (heartbeat_grace_seconds BETWEEN 0 AND 86400);
    END IF;
END $$;

COMMIT;
