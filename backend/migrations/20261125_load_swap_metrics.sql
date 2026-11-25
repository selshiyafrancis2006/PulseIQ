BEGIN;

ALTER TABLE metrics
    ADD COLUMN IF NOT EXISTS load_avg FLOAT,
    ADD COLUMN IF NOT EXISTS swap_usage FLOAT;

ALTER TABLE metric_rollups_5m
    ADD COLUMN IF NOT EXISTS load_avg_avg FLOAT,
    ADD COLUMN IF NOT EXISTS load_avg_min FLOAT,
    ADD COLUMN IF NOT EXISTS load_avg_max FLOAT,
    ADD COLUMN IF NOT EXISTS swap_usage_avg FLOAT,
    ADD COLUMN IF NOT EXISTS swap_usage_min FLOAT,
    ADD COLUMN IF NOT EXISTS swap_usage_max FLOAT;

ALTER TABLE metric_rollups_1h
    ADD COLUMN IF NOT EXISTS load_avg_avg FLOAT,
    ADD COLUMN IF NOT EXISTS load_avg_min FLOAT,
    ADD COLUMN IF NOT EXISTS load_avg_max FLOAT,
    ADD COLUMN IF NOT EXISTS swap_usage_avg FLOAT,
    ADD COLUMN IF NOT EXISTS swap_usage_min FLOAT,
    ADD COLUMN IF NOT EXISTS swap_usage_max FLOAT;

COMMIT;
