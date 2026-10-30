BEGIN;

ALTER TABLE public.monitors
    ADD COLUMN IF NOT EXISTS method VARCHAR(10) NOT NULL DEFAULT 'GET',
    ADD COLUMN IF NOT EXISTS headers JSONB NOT NULL DEFAULT '{}'::jsonb,
    ADD COLUMN IF NOT EXISTS body TEXT,
    ADD COLUMN IF NOT EXISTS timeout_ms INTEGER NOT NULL DEFAULT 10000;

DO $migration$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'monitors_timeout_ms_check'
          AND conrelid = 'public.monitors'::regclass
    ) THEN
        ALTER TABLE public.monitors
            ADD CONSTRAINT monitors_timeout_ms_check
            CHECK (timeout_ms BETWEEN 1 AND 30000);
    END IF;
END
$migration$;

COMMIT;
