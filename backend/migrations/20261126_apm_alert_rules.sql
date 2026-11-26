BEGIN;

-- Default APM alert rules for users that already exist. New users get the same
-- rules from DEFAULT_ALERT_RULES in auth.service.js. Safe to re-run: a user
-- that already has a rule for a metric is skipped.
INSERT INTO alert_rules (metric_name, operator, threshold, duration, user_id)
SELECT d.metric_name, '>', d.threshold, d.duration, u.id
FROM users u
CROSS JOIN (
    VALUES
        ('apm_p95_ms',     1000, 3),
        ('apm_error_rate',    5, 3)
) AS d(metric_name, threshold, duration)
WHERE NOT EXISTS (
    SELECT 1
    FROM alert_rules ar
    WHERE ar.user_id = u.id
      AND ar.metric_name = d.metric_name
);

COMMIT;
