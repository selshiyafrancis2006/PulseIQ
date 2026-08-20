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

INSERT INTO alert_rules (metric_name, operator, threshold, duration)
VALUES
  ('cpu_usage', '>', 80, 3),
  ('memory_usage', '>', 85, 3),
  ('disk_usage', '>', 90, 1)
ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS monitors (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  url VARCHAR(500) NOT NULL,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW()
);

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