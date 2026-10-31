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
