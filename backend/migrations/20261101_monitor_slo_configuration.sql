BEGIN;

ALTER TABLE monitors
    ADD COLUMN IF NOT EXISTS slo_target_percent NUMERIC(5,2)
        NOT NULL DEFAULT 99.90
        CHECK (slo_target_percent >= 90.00 AND slo_target_percent <= 100.00);

ALTER TABLE monitors
    ADD COLUMN IF NOT EXISTS slo_window_days INTEGER
        NOT NULL DEFAULT 30
        CHECK (slo_window_days BETWEEN 1 AND 365);

COMMIT;
