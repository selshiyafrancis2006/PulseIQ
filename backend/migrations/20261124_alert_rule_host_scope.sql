-- Allow alert rules to apply globally or to one owned host.
-- Existing rows retain NULL host_id and therefore remain global.

ALTER TABLE alert_rules
    ADD COLUMN IF NOT EXISTS host_id INTEGER
    REFERENCES hosts(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_alert_rules_host_scope
    ON alert_rules (user_id, host_id, is_active);