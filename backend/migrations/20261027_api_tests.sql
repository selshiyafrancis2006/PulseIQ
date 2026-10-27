CREATE TABLE IF NOT EXISTS api_tests (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL
        REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    steps JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT api_tests_name_not_empty
        CHECK (length(trim(name)) > 0),

    CONSTRAINT api_tests_steps_array
        CHECK (
            jsonb_typeof(steps) = 'array'
            AND jsonb_array_length(steps) BETWEEN 1 AND 10
        ),

    CONSTRAINT api_tests_id_user_unique UNIQUE (id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_api_tests_user_updated
    ON api_tests (user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS api_test_runs (
    id BIGSERIAL PRIMARY KEY,
    api_test_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    status VARCHAR(10) NOT NULL
        CHECK (status IN ('passed', 'failed')),
    results JSONB NOT NULL DEFAULT '[]'::jsonb,
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    finished_at TIMESTAMPTZ,
    duration_ms INTEGER
        CHECK (duration_ms IS NULL OR duration_ms >= 0),

    CONSTRAINT api_test_runs_test_owner_fk
        FOREIGN KEY (api_test_id, user_id)
        REFERENCES api_tests(id, user_id) ON DELETE CASCADE,

    CONSTRAINT api_test_runs_results_array
        CHECK (jsonb_typeof(results) = 'array')
);

CREATE INDEX IF NOT EXISTS idx_api_test_runs_test_started
    ON api_test_runs (api_test_id, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_api_test_runs_user_started
    ON api_test_runs (user_id, started_at DESC);
