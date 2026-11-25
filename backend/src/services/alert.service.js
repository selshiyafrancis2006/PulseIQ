const pool = require('../config/db');
const { PERCENT_METRICS } = require('../config/metrics');
const { notifyMetricChanges } = require('./metricAlertNotification.service');

function getAlertSeverity(metricName, value) {
    const percentageMetrics = new Set(PERCENT_METRICS);

    if (percentageMetrics.has(metricName) && value >= 90) {
        return 'Critical';
    }

    return 'Warning';
}


async function evaluateAlerts(metric) {
    let client;
    let committed = false;

    // Alerts that opened or recovered during this sample. They are sent after
    // the transaction ends, so a slow channel never holds the database lock.
    const changes = [];

    try {
        client = await pool.connect();
        await client.query('BEGIN');

        const rulesResult = await client.query(`
            SELECT ar.*
            FROM alert_rules ar
            JOIN hosts h ON h.user_id = ar.user_id
            WHERE h.id = $1
              AND ar.is_active = true
              AND (ar.host_id IS NULL OR ar.host_id = $1)
            ORDER BY ar.id
            FOR UPDATE OF ar
        `, [metric.host_id]);

        for (const rule of rulesResult.rows) {
            const value = metric[rule.metric_name];

            if (value === undefined || value === null || !Number.isFinite(Number(value))) {
                continue;
            }

            let conditionMet = false;

            switch (rule.operator) {
                case '>':
                    conditionMet = value > rule.threshold;
                    break;
                case '<':
                    conditionMet = value < rule.threshold;
                    break;
                case '>=':
                    conditionMet = value >= rule.threshold;
                    break;
                case '<=':
                    conditionMet = value <= rule.threshold;
                    break;
                default:
                    continue;
            }

            await client.query(`
                INSERT INTO alert_rule_states (
                    host_id,
                    rule_id,
                    consecutive_breaches,
                    is_breaching,
                    updated_at
                )
                VALUES ($1, $2, 0, false, NOW())
                ON CONFLICT (host_id, rule_id) DO NOTHING
            `, [metric.host_id, rule.id]);

            const lockedState = await client.query(`
                SELECT consecutive_breaches, is_breaching
                FROM alert_rule_states
                WHERE host_id = $1 AND rule_id = $2
                FOR UPDATE
            `, [metric.host_id, rule.id]);

            const state = lockedState.rows[0];

            if (conditionMet) {
                if (state.is_breaching) {
                    continue;
                }

                const count = state.consecutive_breaches + 1;

                if (count >= Math.max(1, rule.duration || 1)) {
                    const severity = getAlertSeverity(rule.metric_name, Number(value));

                    await client.query(`
                        INSERT INTO alerts (
                            metric_name,
                            metric_value,
                            average_value,
                            severity,
                            host_id,
                            timestamp
                        )
                        VALUES ($1, $2, $3, $4, $5, NOW())
                    `, [
                        rule.metric_name,
                        Number(value),
                        rule.threshold,
                        severity,
                        metric.host_id
                    ]);

                    await client.query(`
                        UPDATE alert_rule_states
                        SET consecutive_breaches = 0,
                            is_breaching = true,
                            updated_at = NOW()
                        WHERE host_id = $1 AND rule_id = $2
                    `, [metric.host_id, rule.id]);

                    changes.push({
                        kind: 'triggered',
                        userId: rule.user_id,
                        hostId: metric.host_id,
                        metricName: rule.metric_name,
                        value: Number(value),
                        threshold: rule.threshold,
                        operator: rule.operator,
                        severity
                    });

                    console.log(
                        `Alert triggered: ${rule.metric_name} (host_id: ${metric.host_id})`
                    );
                } else {
                    await client.query(`
                        UPDATE alert_rule_states
                        SET consecutive_breaches = $3,
                            updated_at = NOW()
                        WHERE host_id = $1 AND rule_id = $2
                    `, [metric.host_id, rule.id, count]);
                }
            } else {
                // The rule was breaching and is now back to normal.
                if (state.is_breaching) {
                    changes.push({
                        kind: 'recovered',
                        userId: rule.user_id,
                        hostId: metric.host_id,
                        metricName: rule.metric_name,
                        value: Number(value),
                        threshold: rule.threshold,
                        operator: rule.operator,
                        severity: null
                    });
                }

                await client.query(`
                    UPDATE alert_rule_states
                    SET consecutive_breaches = 0,
                        is_breaching = false,
                        updated_at = NOW()
                    WHERE host_id = $1 AND rule_id = $2
                `, [metric.host_id, rule.id]);
            }
        }

        await client.query('COMMIT');
        committed = true;

    } catch (err) {
        if (client) {
            try {
                await client.query('ROLLBACK');
            } catch (rollbackError) {
                console.error('Alert engine rollback error:', rollbackError);
            }
        }

        console.error('Alert engine error:', err);
    } finally {
        if (client) {
            client.release();
        }
    }

    // Keep production metric ingestion non-blocking. In tests, await delivery
    // so the database pool cannot close while notification queries are active.
    if (committed && changes.length > 0) {
        const notificationTask = notifyMetricChanges(changes);

        if (process.env.NODE_ENV === 'test') {
            await notificationTask.catch((err) => {
                console.error('Metric alert notification failed:', err.message);
            });
        } else {
            notificationTask.catch((err) => {
                console.error('Metric alert notification failed:', err.message);
            });
        }
    }
}


async function fetchAlerts(hostId, userId, limit = 20, offset = 0) {
    const result = await pool.query(`
        SELECT a.*
        FROM alerts a
        JOIN hosts h ON h.id = a.host_id
        WHERE h.user_id = $1
          AND ($2::int IS NULL OR h.id = $2)
        ORDER BY a.timestamp DESC, a.id DESC
        LIMIT $3 OFFSET $4
    `, [userId, hostId, limit, offset]);

    return result.rows.map(alert => ({
        id: alert.id,
        metric_name: alert.metric_name,
        current_value: alert.metric_value,
        threshold_value: alert.average_value,
        host_id: alert.host_id,
        severity: alert.severity || getAlertSeverity(alert.metric_name, alert.metric_value),
        timestamp: alert.timestamp,
        acknowledged_at: alert.acknowledged_at,
        acknowledged_by: alert.acknowledged_by
    }));
}

async function acknowledgeAlert(alertId, userId) {
    const result = await pool.query(`
        UPDATE alerts a
        SET acknowledged_at = COALESCE(a.acknowledged_at, NOW()),
            acknowledged_by = COALESCE(a.acknowledged_by, $2)
        FROM hosts h
        WHERE a.id = $1
          AND a.host_id = h.id
          AND h.user_id = $2
        RETURNING
            a.id,
            a.acknowledged_at,
            a.acknowledged_by
    `, [alertId, userId]);

    return result.rows[0] || null;
}

async function fetchRules(userId) {
    const result = await pool.query(
        `SELECT * FROM alert_rules WHERE user_id = $1 ORDER BY id ASC`,
        [userId]
    );
    return result.rows;
}

async function createRule(userId, rule) {
    if (rule.host_id !== null) {
        const hostResult = await pool.query(
            `SELECT id FROM hosts WHERE id = $1 AND user_id = $2`,
            [rule.host_id, userId]
        );

        if (hostResult.rows.length === 0) {
            return null;
        }
    }

    const result = await pool.query(`
        INSERT INTO alert_rules (
            user_id,
            host_id,
            metric_name,
            operator,
            threshold,
            duration,
            is_active
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING *
    `, [
        userId,
        rule.host_id,
        rule.metric_name,
        rule.operator,
        rule.threshold,
        rule.duration,
        rule.is_active
    ]);

    return result.rows[0] || null;
}

async function updateRule(id, userId, updates) {
    const allowedFields = [
        'metric_name',
        'operator',
        'threshold',
        'duration',
        'is_active',
        'host_id'
    ];

    const fields = allowedFields.filter(
        field => Object.prototype.hasOwnProperty.call(updates, field)
    );

    if (fields.length === 0) {
        return null;
    }

    if (
        Object.prototype.hasOwnProperty.call(updates, 'host_id') &&
        updates.host_id !== null
    ) {
        const hostResult = await pool.query(
            `SELECT id FROM hosts WHERE id = $1 AND user_id = $2`,
            [updates.host_id, userId]
        );

        if (hostResult.rows.length === 0) {
            return null;
        }
    }

    const values = fields.map(field => updates[field]);
    const assignments = fields.map(
        (field, index) => `${field} = $${index + 1}`
    );

    values.push(id, userId);

    const result = await pool.query(`
        UPDATE alert_rules
        SET ${assignments.join(', ')}
        WHERE id = $${values.length - 1}
          AND user_id = $${values.length}
        RETURNING *
    `, values);

    return result.rows[0] || null;
}

async function deleteRule(id, userId) {
    const result = await pool.query(`
        DELETE FROM alert_rules
        WHERE id = $1 AND user_id = $2
        RETURNING id
    `, [id, userId]);

    return result.rows[0] || null;
}

module.exports = {
    evaluateAlerts,
    fetchAlerts,
    acknowledgeAlert,
    fetchRules,
    createRule,
    updateRule,
    deleteRule
};