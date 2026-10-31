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
    CHECK (monitor_type IN ('HTTP', 'TCP', 'DNS', 'HEARTBEAT'));

CREATE TABLE IF NOT EXISTS heartbeat_monitor_secrets (
    monitor_id INTEGER PRIMARY KEY
        REFERENCES monitors(id) ON DELETE CASCADE,
    token_hash CHAR(64) NOT NULL UNIQUE,
    last_seen_at TIMESTAMPTZ,
    CONSTRAINT heartbeat_token_hash_format
        CHECK (token_hash ~ '^[a-f0-9]{64}$')
);

CREATE INDEX IF NOT EXISTS idx_heartbeat_monitor_last_seen
    ON heartbeat_monitor_secrets (last_seen_at);

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
ALTER TABLE monitors
    ADD COLUMN IF NOT EXISTS next_check_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

ALTER TABLE monitors
    ADD COLUMN IF NOT EXISTS check_claim_token UUID,
    ADD COLUMN IF NOT EXISTS check_claimed_until TIMESTAMPTZ;

DO $migration$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'monitors_check_claim_pair'
          AND conrelid = 'public.monitors'::regclass
    ) THEN
        ALTER TABLE monitors
            ADD CONSTRAINT monitors_check_claim_pair
            CHECK (
                (check_claim_token IS NULL) =
                (check_claimed_until IS NULL)
            );
    END IF;
END
$migration$;

CREATE INDEX IF NOT EXISTS idx_monitors_due
    ON monitors (next_check_at, id)
    WHERE is_active = true;
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

CREATE TABLE IF NOT EXISTS status_page_incidents (
    id BIGSERIAL PRIMARY KEY,
    status_page_id INTEGER NOT NULL
        REFERENCES status_pages(id) ON DELETE CASCADE,
    title VARCHAR(160) NOT NULL,
    impact VARCHAR(10) NOT NULL
        CHECK (impact IN ('minor', 'major', 'critical')),
    status VARCHAR(20) NOT NULL DEFAULT 'investigating'
        CHECK (status IN ('investigating', 'identified', 'monitoring', 'resolved')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    resolved_at TIMESTAMPTZ,
    CONSTRAINT status_page_incident_title_not_empty
        CHECK (length(trim(title)) > 0),
    CONSTRAINT status_page_incident_resolution_consistent
        CHECK (
            (status = 'resolved' AND resolved_at IS NOT NULL)
            OR
            (status <> 'resolved' AND resolved_at IS NULL)
        )
);

CREATE TABLE IF NOT EXISTS status_page_incident_updates (
    id BIGSERIAL PRIMARY KEY,
    incident_id BIGINT NOT NULL
        REFERENCES status_page_incidents(id) ON DELETE CASCADE,
    status VARCHAR(20) NOT NULL
        CHECK (status IN ('investigating', 'identified', 'monitoring', 'resolved')),
    message TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT status_page_incident_update_message_not_empty
        CHECK (length(trim(message)) > 0)
);

CREATE TABLE IF NOT EXISTS status_page_incident_monitors (
    incident_id BIGINT NOT NULL
        REFERENCES status_page_incidents(id) ON DELETE CASCADE,
    monitor_id INTEGER NOT NULL
        REFERENCES monitors(id) ON DELETE CASCADE,
    PRIMARY KEY (incident_id, monitor_id)
);

CREATE INDEX IF NOT EXISTS idx_status_page_incidents_page_updated
    ON status_page_incidents (status_page_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_status_page_incidents_status
    ON status_page_incidents (status_page_id, status);

CREATE INDEX IF NOT EXISTS idx_status_page_incident_updates_timeline
    ON status_page_incident_updates (incident_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_status_page_incident_monitors_monitor
    ON status_page_incident_monitors (monitor_id);

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

        await client.query(`
ALTER TABLE notification_channels
    ADD COLUMN IF NOT EXISTS email TEXT;

ALTER TABLE notification_channels
    ALTER COLUMN url DROP NOT NULL;

ALTER TABLE notification_channels
    DROP CONSTRAINT IF EXISTS notification_channels_type_check;

ALTER TABLE notification_channels
    ADD CONSTRAINT notification_channels_type_check
    CHECK (type IN ('slack', 'webhook', 'email'));

ALTER TABLE notification_channels
    DROP CONSTRAINT IF EXISTS notification_channels_destination_check;

ALTER TABLE notification_channels
    ADD CONSTRAINT notification_channels_destination_check
    CHECK (
        (
            type IN ('slack', 'webhook')
            AND url IS NOT NULL
            AND length(trim(url)) > 0
            AND email IS NULL
        )
        OR
        (
            type = 'email'
            AND url IS NULL
            AND email IS NOT NULL
            AND length(trim(email)) > 0
        )
    );
        `);
    } finally {
        await client.end();
    }
};


