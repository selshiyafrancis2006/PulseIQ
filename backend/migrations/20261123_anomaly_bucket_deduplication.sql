ALTER TABLE anomalies
    ADD COLUMN IF NOT EXISTS bucket_start TIMESTAMPTZ;

CREATE UNIQUE INDEX IF NOT EXISTS idx_anomalies_host_metric_bucket
    ON anomalies (host_id, metric_name, bucket_start)
    WHERE bucket_start IS NOT NULL;

CREATE TABLE IF NOT EXISTS anomaly_detection_buckets (
    host_id INTEGER NOT NULL
        REFERENCES hosts(id) ON DELETE CASCADE,
    metric_name VARCHAR(50) NOT NULL,
    bucket_start TIMESTAMPTZ NOT NULL,
    processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (host_id, metric_name, bucket_start)
);

CREATE INDEX IF NOT EXISTS idx_anomaly_detection_buckets_processed
    ON anomaly_detection_buckets (processed_at);
