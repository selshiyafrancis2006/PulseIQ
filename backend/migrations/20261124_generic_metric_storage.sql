BEGIN;

-- Generic raw metric observations: one row per metric per sample.
CREATE TABLE IF NOT EXISTS metric_observations (
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

    CONSTRAINT metric_observations_name_check
        CHECK (metric_name ~ '^[a-zA-Z][a-zA-Z0-9_.-]{0,99}$'),

    CONSTRAINT metric_observations_value_check
        CHECK (
            value > '-Infinity'::DOUBLE PRECISION
            AND value < 'Infinity'::DOUBLE PRECISION
        ),

    CONSTRAINT metric_observations_tags_check
        CHECK (jsonb_typeof(tags) = 'object'),

    CONSTRAINT metric_observations_sample_unique
        UNIQUE (host_id, sample_id, metric_name, tags)
);

CREATE INDEX IF NOT EXISTS idx_metric_observations_host_collected
    ON metric_observations (host_id, collected_at DESC);

CREATE INDEX IF NOT EXISTS idx_metric_observations_host_name_collected
    ON metric_observations (host_id, metric_name, collected_at DESC);


-- Generic five-minute metric rollups.
CREATE TABLE IF NOT EXISTS metric_rollups_5m_generic (
    id BIGSERIAL PRIMARY KEY,
    host_id INTEGER NOT NULL
        REFERENCES hosts(id) ON DELETE CASCADE,
    metric_name VARCHAR(100) NOT NULL,
    unit VARCHAR(32),
    tags JSONB NOT NULL DEFAULT '{}'::jsonb,
    bucket_start TIMESTAMPTZ NOT NULL,
    value_avg DOUBLE PRECISION,
    value_min DOUBLE PRECISION,
    value_max DOUBLE PRECISION,
    sample_count INTEGER NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT metric_rollups_5m_generic_name_check
        CHECK (metric_name ~ '^[a-zA-Z][a-zA-Z0-9_.-]{0,99}$'),

    CONSTRAINT metric_rollups_5m_generic_tags_check
        CHECK (jsonb_typeof(tags) = 'object'),

    CONSTRAINT metric_rollups_5m_generic_count_check
        CHECK (sample_count > 0),

    CONSTRAINT metric_rollups_5m_generic_bucket_unique
        UNIQUE NULLS NOT DISTINCT
        (host_id, metric_name, unit, tags, bucket_start)
);

CREATE INDEX IF NOT EXISTS idx_metric_rollups_5m_generic_host_metric_bucket
    ON metric_rollups_5m_generic
    (host_id, metric_name, bucket_start DESC);


-- Generic hourly metric rollups.
CREATE TABLE IF NOT EXISTS metric_rollups_1h_generic (
    id BIGSERIAL PRIMARY KEY,
    host_id INTEGER NOT NULL
        REFERENCES hosts(id) ON DELETE CASCADE,
    metric_name VARCHAR(100) NOT NULL,
    unit VARCHAR(32),
    tags JSONB NOT NULL DEFAULT '{}'::jsonb,
    bucket_start TIMESTAMPTZ NOT NULL,
    value_avg DOUBLE PRECISION,
    value_min DOUBLE PRECISION,
    value_max DOUBLE PRECISION,
    sample_count INTEGER NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT metric_rollups_1h_generic_name_check
        CHECK (metric_name ~ '^[a-zA-Z][a-zA-Z0-9_.-]{0,99}$'),

    CONSTRAINT metric_rollups_1h_generic_tags_check
        CHECK (jsonb_typeof(tags) = 'object'),

    CONSTRAINT metric_rollups_1h_generic_count_check
        CHECK (sample_count > 0),

    CONSTRAINT metric_rollups_1h_generic_bucket_unique
        UNIQUE NULLS NOT DISTINCT
        (host_id, metric_name, unit, tags, bucket_start)
);

CREATE INDEX IF NOT EXISTS idx_metric_rollups_1h_generic_host_metric_bucket
    ON metric_rollups_1h_generic
    (host_id, metric_name, bucket_start DESC);

COMMIT;