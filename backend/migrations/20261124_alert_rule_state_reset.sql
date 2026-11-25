-- Clear a rule's breach state when the rule is switched on or off, moved to
-- another host, or pointed at another metric.
--
-- Without this, a rule that was disabled while breaching kept is_breaching =
-- true. Re-enabling it later sent a "recovered" message for an alert raised
-- before it was disabled, and a rule moved to another host kept stale state
-- rows for the old one.
--
-- Editing only the threshold, operator or duration deliberately keeps the
-- state, so saving a changed threshold does not send a duplicate alert.

CREATE OR REPLACE FUNCTION reset_alert_rule_state() RETURNS trigger AS $$
BEGIN
    DELETE FROM alert_rule_states WHERE rule_id = NEW.id;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_alert_rule_state_reset ON alert_rules;

CREATE TRIGGER trg_alert_rule_state_reset
AFTER UPDATE OF is_active, host_id, metric_name ON alert_rules
FOR EACH ROW
WHEN (
    OLD.is_active IS DISTINCT FROM NEW.is_active
    OR OLD.host_id IS DISTINCT FROM NEW.host_id
    OR OLD.metric_name IS DISTINCT FROM NEW.metric_name
)
EXECUTE PROCEDURE reset_alert_rule_state();