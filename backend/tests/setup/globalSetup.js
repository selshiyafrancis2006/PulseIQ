const { Client } = require('pg');

module.exports = async function globalSetup() {
    const database = process.env.TEST_DB_NAME || 'pulseiq_test';

    if (!database.endsWith('_test')) {
        throw new Error(
            `Refusing schema setup for "${database}": database name must end with "_test".`
        );
    }

    const dotenv = require('dotenv');
    const path = require('path');

    dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

    const client = new Client({
        host: process.env.TEST_DB_HOST || 'localhost',
        port: process.env.TEST_DB_PORT || '5433',
        user: process.env.TEST_DB_USER || 'postgres',
        password:
            process.env.TEST_DB_PASSWORD ||
            process.env.POSTGRES_PASSWORD ||
            process.env.DB_PASSWORD,
        database,
    });

    try {
        await client.connect();
        await client.query(`
            ALTER TABLE monitor_results
                ADD COLUMN IF NOT EXISTS certificate_expires_at TIMESTAMPTZ,
                ADD COLUMN IF NOT EXISTS certificate_days_remaining INTEGER;
        `);

        await client.query(`
            CREATE TABLE IF NOT EXISTS monitor_certificate_alert_state (
                monitor_id INTEGER PRIMARY KEY
                    REFERENCES monitors(id) ON DELETE CASCADE,
                certificate_expires_at TIMESTAMPTZ,
                last_alert_level SMALLINT NOT NULL DEFAULT 0
                    CHECK (last_alert_level BETWEEN 0 AND 4),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );
        `);
        await client.query(`

ALTER TABLE monitors
    ADD COLUMN IF NOT EXISTS failure_threshold INTEGER NOT NULL DEFAULT 1,
    ADD COLUMN IF NOT EXISTS monitor_type VARCHAR(10) NOT NULL DEFAULT 'HTTP',
    ADD COLUMN IF NOT EXISTS tcp_host VARCHAR(253),
    ADD COLUMN IF NOT EXISTS tcp_port INTEGER,
    ADD COLUMN IF NOT EXISTS dns_hostname VARCHAR(253),
    ADD COLUMN IF NOT EXISTS dns_record_type VARCHAR(10) NOT NULL DEFAULT 'A',
    ADD COLUMN IF NOT EXISTS method VARCHAR(10) NOT NULL DEFAULT 'GET',
    ADD COLUMN IF NOT EXISTS headers JSONB NOT NULL DEFAULT '{}'::jsonb,
    ADD COLUMN IF NOT EXISTS body TEXT,
    ADD COLUMN IF NOT EXISTS timeout_ms INTEGER NOT NULL DEFAULT 10000,
    ADD COLUMN IF NOT EXISTS expected_status_codes JSONB,
    ADD COLUMN IF NOT EXISTS expected_keyword VARCHAR(500),
    ADD COLUMN IF NOT EXISTS max_response_time_ms INTEGER;


ALTER TABLE monitors
    DROP CONSTRAINT IF EXISTS monitors_monitor_type_check;

ALTER TABLE monitors
    ADD CONSTRAINT monitors_monitor_type_check
    CHECK (monitor_type IN ('HTTP', 'TCP', 'DNS'));

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'monitors_tcp_port_check'
          AND conrelid = 'monitors'::regclass
    ) THEN
        ALTER TABLE monitors
            ADD CONSTRAINT monitors_tcp_port_check
            CHECK (tcp_port IS NULL OR tcp_port BETWEEN 1 AND 65535);
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'monitors_timeout_ms_check'
          AND conrelid = 'monitors'::regclass
    ) THEN
        ALTER TABLE monitors
            ADD CONSTRAINT monitors_timeout_ms_check
            CHECK (timeout_ms BETWEEN 1 AND 30000);
    END IF;
END $$;

CREATE OR REPLACE FUNCTION public.is_valid_http_status_codes(value JSONB)
RETURNS BOOLEAN
LANGUAGE plpgsql
IMMUTABLE
AS $function$
DECLARE
    item JSONB;
    code NUMERIC;
    seen_codes INTEGER[] := ARRAY[]::INTEGER[];
BEGIN
    IF value IS NULL THEN
        RETURN TRUE;
    END IF;

    IF jsonb_typeof(value) <> 'array' THEN
        RETURN FALSE;
    END IF;

    IF jsonb_array_length(value) NOT BETWEEN 1 AND 20 THEN
        RETURN FALSE;
    END IF;

    FOR item IN SELECT jsonb_array_elements(value)
    LOOP
        IF jsonb_typeof(item) <> 'number' THEN
            RETURN FALSE;
        END IF;

        code := (item #>> '{}')::NUMERIC;

        IF code <> trunc(code) OR code < 100 OR code > 599 THEN
            RETURN FALSE;
        END IF;

        IF code::INTEGER = ANY(seen_codes) THEN
            RETURN FALSE;
        END IF;

        seen_codes := array_append(seen_codes, code::INTEGER);
    END LOOP;

    RETURN TRUE;
END;
$function$;

ALTER TABLE monitors
    DROP CONSTRAINT IF EXISTS monitors_expected_status_codes_check;

ALTER TABLE monitors
    ADD CONSTRAINT monitors_expected_status_codes_check
    CHECK (public.is_valid_http_status_codes(expected_status_codes));

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'monitors_max_response_time_check'
          AND conrelid = 'monitors'::regclass
    ) THEN
        ALTER TABLE monitors
            ADD CONSTRAINT monitors_max_response_time_check
            CHECK (
                max_response_time_ms IS NULL
                OR max_response_time_ms BETWEEN 1 AND 30000
            );
    END IF;
END $$;

        `);


        await client.query(`
CREATE TABLE IF NOT EXISTS status_pages (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    slug VARCHAR(64) NOT NULL UNIQUE,
    title VARCHAR(120) NOT NULL DEFAULT 'System Status',
    description VARCHAR(500) NOT NULL DEFAULT '',
    is_public BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS status_page_monitors (
    status_page_id INTEGER NOT NULL REFERENCES status_pages(id) ON DELETE CASCADE,
    monitor_id INTEGER NOT NULL REFERENCES monitors(id) ON DELETE CASCADE,
    PRIMARY KEY (status_page_id, monitor_id)
);

CREATE INDEX IF NOT EXISTS idx_status_page_monitors_monitor
    ON status_page_monitors (monitor_id);

CREATE TABLE IF NOT EXISTS monitor_check_state (
    monitor_id INTEGER PRIMARY KEY
        REFERENCES monitors(id) ON DELETE CASCADE,
    confirmed_status VARCHAR(10)
        CHECK (confirmed_status IN ('UP', 'DOWN')),
    consecutive_failures INTEGER NOT NULL DEFAULT 0
        CHECK (consecutive_failures >= 0),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
        `);
        await client.query(`
CREATE TABLE IF NOT EXISTS api_tests (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    steps JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT api_tests_name_not_empty CHECK (length(trim(name)) > 0),
    CONSTRAINT api_tests_steps_array CHECK (
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
    status VARCHAR(10) NOT NULL CHECK (status IN ('passed', 'failed')),
    results JSONB NOT NULL DEFAULT '[]'::jsonb,
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    finished_at TIMESTAMPTZ,
    duration_ms INTEGER CHECK (duration_ms IS NULL OR duration_ms >= 0),
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
        `);
    } finally {
        await client.end();
    }
};
