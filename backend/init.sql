CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  email VARCHAR(255) UNIQUE NOT NULL,
  password VARCHAR(255) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS metrics (
  id SERIAL PRIMARY KEY,
  cpu_usage FLOAT,
  memory_usage FLOAT,
  disk_usage FLOAT,
  network_in FLOAT,
  network_out FLOAT,
  timestamp TIMESTAMPTZ DEFAULT NOW()
);

-- Hosts must exist before tables that reference hosts(id).
CREATE TABLE IF NOT EXISTS hosts (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  api_key_hash VARCHAR(64) NOT NULL,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_hosts_user ON hosts (user_id);

-- Each user can register a host name only once.
CREATE UNIQUE INDEX IF NOT EXISTS idx_hosts_user_name
  ON hosts (user_id, name);

-- Remove the obsolete duplicate index.
DROP INDEX IF EXISTS idx_hosts_user_name_unique;

-- Alerts associated with individual hosts.
CREATE TABLE IF NOT EXISTS alerts (
  id SERIAL PRIMARY KEY,
  metric_name VARCHAR(50),
  metric_value FLOAT,
  average_value FLOAT,
  severity VARCHAR(20) NOT NULL DEFAULT 'Warning',
  host_id INTEGER REFERENCES hosts(id) ON DELETE CASCADE,
  timestamp TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_alerts_host_timestamp
  ON alerts (host_id, timestamp DESC);

CREATE TABLE IF NOT EXISTS alert_rules (
  id SERIAL PRIMARY KEY,
  metric_name VARCHAR(50) NOT NULL,
  operator VARCHAR(5) NOT NULL,
  threshold FLOAT NOT NULL,
  duration INTEGER DEFAULT 1,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);


-- Persist alert evaluation state across backend restarts.
CREATE TABLE IF NOT EXISTS alert_rule_states (
    host_id INTEGER NOT NULL REFERENCES hosts(id) ON DELETE CASCADE,
    rule_id INTEGER NOT NULL REFERENCES alert_rules(id) ON DELETE CASCADE,
    consecutive_breaches INTEGER NOT NULL DEFAULT 0,
    is_breaching BOOLEAN NOT NULL DEFAULT false,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (host_id, rule_id)
);


CREATE TABLE IF NOT EXISTS monitors (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  url VARCHAR(500) NOT NULL,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_monitors_user ON monitors (user_id);


CREATE TABLE IF NOT EXISTS monitor_results (
  id SERIAL PRIMARY KEY,
  monitor_id INTEGER REFERENCES monitors(id) ON DELETE CASCADE,
  status VARCHAR(10) NOT NULL,
  response_time_ms INTEGER,
  status_code INTEGER,
  error_type VARCHAR(50),
  error_message TEXT,
dns_time_ms DOUBLE PRECISION,
connect_time_ms DOUBLE PRECISION,
tls_time_ms DOUBLE PRECISION,
certificate_expires_at TIMESTAMPTZ,
certificate_days_remaining INTEGER,
ttfb_time_ms DOUBLE PRECISION,
download_time_ms DOUBLE PRECISION,
checked_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_monitor_results_monitor_checked
  ON monitor_results (monitor_id, checked_at DESC);

CREATE TABLE IF NOT EXISTS logs (
  id SERIAL PRIMARY KEY,
  level VARCHAR(10) NOT NULL,
  service VARCHAR(100),
  source VARCHAR(100),
  method VARCHAR(10),
  endpoint VARCHAR(255),
  status_code INTEGER,
  response_time_ms INTEGER,
  ip_address VARCHAR(50),
  message TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_logs_created_at
  ON logs (created_at DESC);

CREATE TABLE IF NOT EXISTS monitor_events (
  id SERIAL PRIMARY KEY,
  monitor_id INTEGER REFERENCES monitors(id) ON DELETE CASCADE,
  type VARCHAR(10) NOT NULL,
  message TEXT,
  response_time_ms INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_monitor_events_monitor_created
  ON monitor_events (monitor_id, created_at DESC);

ALTER TABLE metrics
  ADD COLUMN IF NOT EXISTS host_id INTEGER
  REFERENCES hosts(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_metrics_host_timestamp
  ON metrics (host_id, timestamp DESC);

CREATE TABLE IF NOT EXISTS metric_rollups_5m (
  id SERIAL PRIMARY KEY,
  host_id INTEGER REFERENCES hosts(id) ON DELETE CASCADE,
  bucket_start TIMESTAMPTZ NOT NULL,
  cpu_usage_avg FLOAT,
  cpu_usage_min FLOAT,
  cpu_usage_max FLOAT,
  memory_usage_avg FLOAT,
  memory_usage_min FLOAT,
  memory_usage_max FLOAT,
  disk_usage_avg FLOAT,
  disk_usage_min FLOAT,
  disk_usage_max FLOAT,
  network_in_avg FLOAT,
  network_in_min FLOAT,
  network_in_max FLOAT,
  network_out_avg FLOAT,
  network_out_min FLOAT,
  network_out_max FLOAT,
  sample_count INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (host_id, bucket_start)
);

CREATE INDEX IF NOT EXISTS idx_rollup5m_host_bucket
  ON metric_rollups_5m (host_id, bucket_start DESC);

CREATE TABLE IF NOT EXISTS metric_rollups_1h (
  id SERIAL PRIMARY KEY,
  host_id INTEGER REFERENCES hosts(id) ON DELETE CASCADE,
  bucket_start TIMESTAMPTZ NOT NULL,
  cpu_usage_avg FLOAT,
  cpu_usage_min FLOAT,
  cpu_usage_max FLOAT,
  memory_usage_avg FLOAT,
  memory_usage_min FLOAT,
  memory_usage_max FLOAT,
  disk_usage_avg FLOAT,
  disk_usage_min FLOAT,
  disk_usage_max FLOAT,
  network_in_avg FLOAT,
  network_in_min FLOAT,
  network_in_max FLOAT,
  network_out_avg FLOAT,
  network_out_min FLOAT,
  network_out_max FLOAT,
  sample_count INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (host_id, bucket_start)
);

CREATE INDEX IF NOT EXISTS idx_rollup1h_host_bucket
  ON metric_rollups_1h (host_id, bucket_start DESC);

ALTER TABLE hosts
  ADD COLUMN IF NOT EXISTS user_id INTEGER
  REFERENCES users(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_hosts_user ON hosts (user_id);

ALTER TABLE alerts
  ADD COLUMN IF NOT EXISTS host_id INTEGER
  REFERENCES hosts(id) ON DELETE CASCADE;

ALTER TABLE alerts
  ADD COLUMN IF NOT EXISTS severity VARCHAR(20) NOT NULL DEFAULT 'Warning';

CREATE INDEX IF NOT EXISTS idx_alerts_host_timestamp
  ON alerts (host_id, timestamp DESC);

ALTER TABLE monitors
  ADD COLUMN IF NOT EXISTS user_id INTEGER
  REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE monitors
  ADD COLUMN IF NOT EXISTS interval_seconds INTEGER NOT NULL DEFAULT 30;

-- HTTP, TCP, and DNS monitor support.
-- Existing monitors remain HTTP.
ALTER TABLE monitors
  ADD COLUMN IF NOT EXISTS monitor_type VARCHAR(10) NOT NULL DEFAULT 'HTTP';

ALTER TABLE monitors
  ADD COLUMN IF NOT EXISTS tcp_host VARCHAR(253);

ALTER TABLE monitors
  ADD COLUMN IF NOT EXISTS tcp_port INTEGER;

ALTER TABLE monitors
  ADD COLUMN IF NOT EXISTS dns_hostname VARCHAR(253);

ALTER TABLE monitors
  ADD COLUMN IF NOT EXISTS dns_record_type VARCHAR(10) NOT NULL DEFAULT 'A';

-- Replace the existing constraint so DNS monitors are permitted.
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

CREATE INDEX IF NOT EXISTS idx_monitors_user ON monitors (user_id);

ALTER TABLE alert_rules
  ADD COLUMN IF NOT EXISTS user_id INTEGER
  REFERENCES users(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_alert_rules_user ON alert_rules (user_id);

ALTER TABLE hosts
  ADD COLUMN IF NOT EXISTS tags TEXT[] DEFAULT '{}';

CREATE INDEX IF NOT EXISTS idx_hosts_tags
  ON hosts USING GIN (tags);

CREATE TABLE IF NOT EXISTS traces (
  id SERIAL PRIMARY KEY,
  host_id INTEGER REFERENCES hosts(id) ON DELETE CASCADE,
  method VARCHAR(10) NOT NULL,
  route VARCHAR(255) NOT NULL,
  status_code INTEGER,
  duration_ms INTEGER,
  timestamp TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_traces_host_timestamp
  ON traces (host_id, timestamp DESC);

CREATE TABLE IF NOT EXISTS metric_baselines (
  id SERIAL PRIMARY KEY,
  host_id INTEGER REFERENCES hosts(id) ON DELETE CASCADE,
  metric_name VARCHAR(50) NOT NULL,
  mean FLOAT NOT NULL,
  stddev FLOAT NOT NULL,
  sample_count INTEGER NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (host_id, metric_name)
);

CREATE TABLE IF NOT EXISTS anomalies (
  id SERIAL PRIMARY KEY,
  host_id INTEGER REFERENCES hosts(id) ON DELETE CASCADE,
  metric_name VARCHAR(50) NOT NULL,
  value FLOAT NOT NULL,
  baseline_mean FLOAT NOT NULL,
  baseline_stddev FLOAT NOT NULL,
  deviation_score FLOAT NOT NULL,
  timestamp TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_anomalies_host_timestamp
  ON anomalies (host_id, timestamp DESC);

ALTER TABLE monitors
  ADD COLUMN IF NOT EXISTS tags TEXT[] DEFAULT '{}';

CREATE INDEX IF NOT EXISTS idx_monitors_tags
  ON monitors USING GIN (tags);

CREATE TABLE IF NOT EXISTS dashboards (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  layout JSONB NOT NULL DEFAULT '[]',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_dashboards_user_id
  ON dashboards (user_id);

ALTER TABLE logs
  ADD COLUMN IF NOT EXISTS user_id INTEGER
  REFERENCES users(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_logs_user_id ON logs (user_id);

-- Host metadata reported by the agent.
ALTER TABLE hosts ADD COLUMN IF NOT EXISTS hostname VARCHAR(255);
ALTER TABLE hosts ADD COLUMN IF NOT EXISTS os VARCHAR(255);
ALTER TABLE hosts ADD COLUMN IF NOT EXISTS platform VARCHAR(50);
ALTER TABLE hosts ADD COLUMN IF NOT EXISTS arch VARCHAR(50);
ALTER TABLE hosts ADD COLUMN IF NOT EXISTS cpu_model VARCHAR(255);
ALTER TABLE hosts ADD COLUMN IF NOT EXISTS cpu_cores INTEGER;
ALTER TABLE hosts ADD COLUMN IF NOT EXISTS total_memory_mb INTEGER;
ALTER TABLE hosts ADD COLUMN IF NOT EXISTS ip_address VARCHAR(64);
ALTER TABLE hosts ADD COLUMN IF NOT EXISTS agent_version VARCHAR(50);
ALTER TABLE hosts ADD COLUMN IF NOT EXISTS boot_time TIMESTAMPTZ;

-- API keys are stored only as SHA-256 hashes. On an existing database the
-- plaintext keys are hashed in place, then the plaintext column is dropped.
ALTER TABLE hosts ADD COLUMN IF NOT EXISTS api_key_hash VARCHAR(64);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'hosts'
      AND column_name = 'api_key'
  ) THEN
    UPDATE hosts
    SET api_key_hash = encode(sha256(convert_to(api_key, 'UTF8')), 'hex')
    WHERE api_key_hash IS NULL;

    ALTER TABLE hosts DROP COLUMN api_key;
  END IF;
END $$;

ALTER TABLE hosts ALTER COLUMN api_key_hash SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_hosts_api_key_hash ON hosts (api_key_hash);

-- Outbound notification channels (Slack / generic webhook), per user.
CREATE TABLE IF NOT EXISTS notification_channels (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type VARCHAR(20) NOT NULL CHECK (type IN ('slack', 'webhook')),
  name VARCHAR(100) NOT NULL,
  url TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notification_channels_user
  ON notification_channels (user_id);

  -- Per-monitor notification state (dedup + flap detection).
CREATE TABLE IF NOT EXISTS monitor_alert_state (
  monitor_id INTEGER PRIMARY KEY REFERENCES monitors(id) ON DELETE CASCADE,
  notified_status VARCHAR(10),
  last_notified_at TIMESTAMPTZ,
  is_flapping BOOLEAN NOT NULL DEFAULT false,
  flapping_since TIMESTAMPTZ,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Re-notify interval for monitors that stay down (0 = disabled).
ALTER TABLE monitors
  ADD COLUMN IF NOT EXISTS renotify_minutes INTEGER NOT NULL DEFAULT 60;

-- Planned maintenance / muting. monitor_id NULL = all of the user's monitors.
CREATE TABLE IF NOT EXISTS maintenance_windows (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  monitor_id INTEGER REFERENCES monitors(id) ON DELETE CASCADE,
  reason VARCHAR(200),
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  CHECK (ends_at > starts_at)
);

CREATE INDEX IF NOT EXISTS idx_maintenance_windows_user
  ON maintenance_windows (user_id, starts_at, ends_at);

CREATE INDEX IF NOT EXISTS idx_maintenance_windows_monitor
  ON maintenance_windows (monitor_id);

-- Results recorded during a maintenance window are flagged, not deleted.
ALTER TABLE monitor_results
  ADD COLUMN IF NOT EXISTS in_maintenance BOOLEAN NOT NULL DEFAULT false;

-- Ensure existing databases have all monitor result fields.
ALTER TABLE monitor_results
  ADD COLUMN IF NOT EXISTS error_type VARCHAR(50),
  ADD COLUMN IF NOT EXISTS error_message TEXT,
  ADD COLUMN IF NOT EXISTS dns_time_ms DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS connect_time_ms DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS tls_time_ms DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS ttfb_time_ms DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS download_time_ms DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS certificate_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS certificate_days_remaining INTEGER;

-- ===== F1: monitor_results retention + hourly rollups =====
CREATE TABLE IF NOT EXISTS monitor_rollups_1h (
  monitor_id INTEGER NOT NULL REFERENCES monitors(id) ON DELETE CASCADE,
  bucket_start TIMESTAMPTZ NOT NULL,
  total_checks INTEGER NOT NULL,        -- non-maintenance checks only
  up_checks INTEGER NOT NULL,           -- non-maintenance UP checks
  maintenance_checks INTEGER NOT NULL DEFAULT 0,
  avg_response_ms DOUBLE PRECISION,
  min_response_ms INTEGER,
  max_response_ms INTEGER,
  p95_response_ms DOUBLE PRECISION,
  PRIMARY KEY (monitor_id, bucket_start)
);

CREATE INDEX IF NOT EXISTS idx_monitor_rollups_1h_bucket
  ON monitor_rollups_1h (bucket_start);

-- Lets the retention DELETE find old rows without a full table scan.
CREATE INDEX IF NOT EXISTS idx_monitor_results_checked_at
  ON monitor_results (checked_at);

-- ===== F3: TIMESTAMP -> TIMESTAMPTZ =====
-- Pin the database default to UTC so date_trunc/bucketing is deterministic.
DO $$
BEGIN
  EXECUTE format('ALTER DATABASE %I SET timezone TO ''UTC''', current_database());
END $$;

-- Convert every remaining TIMESTAMP column. Idempotent: once converted, the
-- loop finds nothing. Aborts untouched unless this session is on UTC,
-- because stored naive values are assumed to be UTC.
DO $$
DECLARE
  r RECORD;
  converted INTEGER := 0;
BEGIN
  IF current_setting('TimeZone') NOT IN ('UTC', 'Etc/UTC') THEN
    RAISE EXCEPTION
      'F3 aborted: session TimeZone is %, expected UTC. Re-run init.sql in a new session.',
      current_setting('TimeZone');
  END IF;

  FOR r IN
    SELECT c.table_name, c.column_name
    FROM information_schema.columns c
    JOIN information_schema.tables t
      ON t.table_schema = c.table_schema AND t.table_name = c.table_name
    WHERE c.table_schema = 'public'
      AND t.table_type = 'BASE TABLE'
      AND c.data_type = 'timestamp without time zone'
    ORDER BY c.table_name, c.ordinal_position
  LOOP
    EXECUTE format(
      'ALTER TABLE %I ALTER COLUMN %I TYPE TIMESTAMPTZ USING %I AT TIME ZONE ''UTC''',
      r.table_name, r.column_name, r.column_name
    );
    converted := converted + 1;
  END LOOP;

  RAISE NOTICE 'F3: converted % timestamp column(s) to TIMESTAMPTZ', converted;
END $$;

-- ===== G1.1: multi-location checks =====

-- Agents (hosts) that also run a monitor, in addition to the central server.
CREATE TABLE IF NOT EXISTS monitor_locations (
  monitor_id INTEGER NOT NULL REFERENCES monitors(id) ON DELETE CASCADE,
  host_id INTEGER NOT NULL REFERENCES hosts(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (monitor_id, host_id)
);

CREATE INDEX IF NOT EXISTS idx_monitor_locations_host
  ON monitor_locations (host_id);

-- Raw probe results reported by agents. The quorum verdict is still written
-- to monitor_results as a single consolidated row, so uptime, history and
-- rollups never double-count.
CREATE TABLE IF NOT EXISTS monitor_location_results (
  id BIGSERIAL PRIMARY KEY,
  monitor_id INTEGER NOT NULL REFERENCES monitors(id) ON DELETE CASCADE,
  host_id INTEGER NOT NULL REFERENCES hosts(id) ON DELETE CASCADE,
  status VARCHAR(10) NOT NULL CHECK (status IN ('UP', 'DOWN')),
  response_time_ms INTEGER,
  status_code INTEGER,
  error_type VARCHAR(50),
  error_message TEXT,
  checked_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Latest result per (monitor, agent), used by quorum evaluation.
CREATE INDEX IF NOT EXISTS idx_monitor_location_results_latest
  ON monitor_location_results (monitor_id, host_id, checked_at DESC);

-- Used by retention cleanup.
CREATE INDEX IF NOT EXISTS idx_monitor_location_results_checked_at
  ON monitor_location_results (checked_at);

-- How many locations must report DOWN before the monitor counts as DOWN.
ALTER TABLE monitors
  ADD COLUMN IF NOT EXISTS quorum INTEGER NOT NULL DEFAULT 1 CHECK (quorum >= 1);

-- ===== G3: multi-step API tests =====
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


