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