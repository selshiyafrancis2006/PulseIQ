CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  email VARCHAR(255) UNIQUE NOT NULL,
  password VARCHAR(255) NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS metrics (
  id SERIAL PRIMARY KEY,
  cpu_usage FLOAT,
  memory_usage FLOAT,
  disk_usage FLOAT,
  network_in FLOAT,
  network_out FLOAT,
  timestamp TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS alerts (
  id SERIAL PRIMARY KEY,
  metric_name VARCHAR(50),
  metric_value FLOAT,
  average_value FLOAT,
  timestamp TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS alert_rules (
  id SERIAL PRIMARY KEY,
  metric_name VARCHAR(50) NOT NULL,
  operator VARCHAR(5) NOT NULL,
  threshold FLOAT NOT NULL,
  duration INTEGER DEFAULT 1,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS monitors (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  url VARCHAR(500) NOT NULL,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_monitors_user ON monitors (user_id);

CREATE TABLE IF NOT EXISTS monitor_results (
  id SERIAL PRIMARY KEY,
  monitor_id INTEGER REFERENCES monitors(id) ON DELETE CASCADE,
  status VARCHAR(10) NOT NULL,
  response_time_ms INTEGER,
  status_code INTEGER,
  checked_at TIMESTAMP DEFAULT NOW()
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
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_logs_created_at ON logs (created_at DESC);

CREATE TABLE IF NOT EXISTS monitor_events (
  id SERIAL PRIMARY KEY,
  monitor_id INTEGER REFERENCES monitors(id) ON DELETE CASCADE,
  type VARCHAR(10) NOT NULL,
  message TEXT,
  response_time_ms INTEGER,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_monitor_events_monitor_created ON monitor_events (monitor_id, created_at DESC);

CREATE TABLE IF NOT EXISTS hosts (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  api_key VARCHAR(255) UNIQUE NOT NULL,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMP DEFAULT NOW(),
  last_seen_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_hosts_user ON hosts (user_id);

CREATE INDEX IF NOT EXISTS idx_hosts_api_key ON hosts (api_key);

ALTER TABLE metrics ADD COLUMN IF NOT EXISTS host_id INTEGER REFERENCES hosts(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_metrics_host_timestamp ON metrics (host_id, timestamp DESC);

CREATE TABLE IF NOT EXISTS metric_rollups_5m (
  id SERIAL PRIMARY KEY,
  host_id INTEGER REFERENCES hosts(id) ON DELETE CASCADE,
  bucket_start TIMESTAMP NOT NULL,
  cpu_usage_avg FLOAT, cpu_usage_min FLOAT, cpu_usage_max FLOAT,
  memory_usage_avg FLOAT, memory_usage_min FLOAT, memory_usage_max FLOAT,
  disk_usage_avg FLOAT, disk_usage_min FLOAT, disk_usage_max FLOAT,
  network_in_avg FLOAT, network_in_min FLOAT, network_in_max FLOAT,
  network_out_avg FLOAT, network_out_min FLOAT, network_out_max FLOAT,
  sample_count INTEGER,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE (host_id, bucket_start)
);

CREATE INDEX IF NOT EXISTS idx_rollup5m_host_bucket
  ON metric_rollups_5m (host_id, bucket_start DESC);

CREATE TABLE IF NOT EXISTS metric_rollups_1h (
  id SERIAL PRIMARY KEY,
  host_id INTEGER REFERENCES hosts(id) ON DELETE CASCADE,
  bucket_start TIMESTAMP NOT NULL,
  cpu_usage_avg FLOAT, cpu_usage_min FLOAT, cpu_usage_max FLOAT,
  memory_usage_avg FLOAT, memory_usage_min FLOAT, memory_usage_max FLOAT,
  disk_usage_avg FLOAT, disk_usage_min FLOAT, disk_usage_max FLOAT,
  network_in_avg FLOAT, network_in_min FLOAT, network_in_max FLOAT,
  network_out_avg FLOAT, network_out_min FLOAT, network_out_max FLOAT,
  sample_count INTEGER,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE (host_id, bucket_start)
);

CREATE INDEX IF NOT EXISTS idx_rollup1h_host_bucket
  ON metric_rollups_1h (host_id, bucket_start DESC);

ALTER TABLE alerts ADD COLUMN IF NOT EXISTS host_id INTEGER REFERENCES hosts(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_alerts_host_timestamp ON alerts (host_id, timestamp DESC);

ALTER TABLE hosts ADD COLUMN IF NOT EXISTS user_id INTEGER REFERENCES users(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_hosts_user ON hosts (user_id);

ALTER TABLE monitors ADD COLUMN IF NOT EXISTS user_id INTEGER REFERENCES users(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_monitors_user ON monitors (user_id);

ALTER TABLE alert_rules ADD COLUMN IF NOT EXISTS user_id INTEGER REFERENCES users(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_alert_rules_user ON alert_rules (user_id);

ALTER TABLE hosts ADD COLUMN IF NOT EXISTS tags TEXT[] DEFAULT '{}';
CREATE INDEX IF NOT EXISTS idx_hosts_tags ON hosts USING GIN (tags);

CREATE TABLE IF NOT EXISTS traces (
  id SERIAL PRIMARY KEY,
  host_id INTEGER REFERENCES hosts(id) ON DELETE CASCADE,
  method VARCHAR(10) NOT NULL,
  route VARCHAR(255) NOT NULL,
  status_code INTEGER,
  duration_ms INTEGER,
  timestamp TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_traces_host_timestamp ON traces (host_id, timestamp DESC);