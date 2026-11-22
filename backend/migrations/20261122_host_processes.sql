-- Latest process snapshot reported by each host's agent (one row per host).
CREATE TABLE IF NOT EXISTS host_processes (
    host_id INTEGER PRIMARY KEY REFERENCES hosts(id) ON DELETE CASCADE,
    collected_at TIMESTAMPTZ NOT NULL,
    processes JSONB NOT NULL DEFAULT '[]'::jsonb,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);