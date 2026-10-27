CREATE TABLE IF NOT EXISTS status_pages (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL UNIQUE
        REFERENCES users(id) ON DELETE CASCADE,
    slug VARCHAR(64) NOT NULL UNIQUE,
    title VARCHAR(120) NOT NULL DEFAULT 'System Status',
    description VARCHAR(500) NOT NULL DEFAULT '',
    is_public BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS status_page_monitors (
    status_page_id INTEGER NOT NULL
        REFERENCES status_pages(id) ON DELETE CASCADE,
    monitor_id INTEGER NOT NULL
        REFERENCES monitors(id) ON DELETE CASCADE,
    PRIMARY KEY (status_page_id, monitor_id)
);

CREATE INDEX IF NOT EXISTS idx_status_page_monitors_monitor
    ON status_page_monitors (monitor_id);
