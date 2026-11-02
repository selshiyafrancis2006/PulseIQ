BEGIN;

ALTER TABLE metrics
    ADD COLUMN IF NOT EXISTS sample_id UUID,
    ADD COLUMN IF NOT EXISTS collected_at TIMESTAMPTZ;

CREATE UNIQUE INDEX IF NOT EXISTS idx_metrics_host_sample_id_unique
    ON metrics (host_id, sample_id);

CREATE INDEX IF NOT EXISTS idx_metrics_host_collected_at
    ON metrics (host_id, (COALESCE(collected_at, timestamp)) DESC);

COMMIT;
