BEGIN;

CREATE TABLE IF NOT EXISTS custom_metrics (
    id BIGSERIAL PRIMARY KEY,
    host_id INTEGER NOT NULL
        REFERENCES hosts(id) ON DELETE CASCADE,
    sample_id UUID NOT NULL,
    metric_name VARCHAR(100) NOT NULL,
    value DOUBLE PRECISION NOT NULL,
    unit VARCHAR(32),
    tags JSONB NOT NULL DEFAULT '{}'::jsonb,
    collected_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT custom_metrics_name_check
        CHECK (metric_name ~ '^[a-zA-Z][a-zA-Z0-9_.-]{0,99}$'),

    CONSTRAINT custom_metrics_tags_check
        CHECK (jsonb_typeof(tags) = 'object'),

    CONSTRAINT custom_metrics_sample_unique
        UNIQUE (host_id, sample_id, metric_name, tags)
);

CREATE INDEX IF NOT EXISTS idx_custom_metrics_host_collected
    ON custom_metrics (host_id, collected_at DESC);

CREATE INDEX IF NOT EXISTS idx_custom_metrics_host_name_collected
    ON custom_metrics (host_id, metric_name, collected_at DESC);

COMMIT;
