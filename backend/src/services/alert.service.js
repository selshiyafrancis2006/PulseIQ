
const pool = require('../config/db');
const { isPercentageMetric } = require('../config/metricRegistry');
const { notifyUser } = require('./notification.service');
const {
    HOST_METRIC_ALERT,
    HOST_METRIC_RECOVERED,
    buildHostMetricEvent
} = require('./hostMetricEvents');

function getAlertSeverity(metricName, value) {

    if (isPercentageMetric(metricName) && value >= 90) {
        return 'Critical';
    }

    return 'Warning';
}

// Sends the notifications collected during an evaluation. This runs after the
// database transaction is committed and its connection released, so a slow or
// broken channel can never hold locks or lose an alert. notifyUser never
// throws, but one failure must not stop the remaining messages either.
async function sendPendingNotifications(pending) {
    for (const { userId, event } of pending) {
        try {
            await notifyUser(userId, event);
        } catch (err) {
            console.error('Host metric notification failed:', err);
        }
    }
}

async function evaluateAlerts(metric) {
    let client;
    const pendingNotifications = [];

    try {
        client = await pool.connect();
        await client.query('BEGIN');

        const rulesResult = await client.query(`
            SELECT ar.*, h.user_id AS host_user_id, h.name AS host_name
            FROM alert_rules ar
            JOIN hosts h ON h.user_id = ar.user_id
            WHERE h.id = $1
              AND ar.is_active = true
              AND (ar.host_id IS NULL OR ar.host_id = h.id)
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
            const host = { id: metric.host_id, name: rule.host_name };

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

                    pendingNotifications.push({
                        userId: rule.host_user_id,
                        event: buildHostMetricEvent({
                            type: HOST_METRIC_ALERT,
                            host,
                            rule,
                            value,
                            severity
                        })
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
                await client.query(`
                    UPDATE alert_rule_states
                    SET consecutive_breaches = 0,
                        is_breaching = false,
                        updated_at = NOW()
                    WHERE host_id = $1 AND rule_id = $2
                `, [metric.host_id, rule.id]);

                // Only announce a recovery for a breach that was announced.
                if (state.is_breaching) {
                    pendingNotifications.push({
                        userId: rule.host_user_id,
                        event: buildHostMetricEvent({
                            type: HOST_METRIC_RECOVERED,
                            host,
                            rule,
                            value
                        })
                    });
                }
            }
        }

        await client.query('COMMIT');

        client.release();
        client = null;

        await sendPendingNotifications(pendingNotifications);

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
    const result = await pool.query(
        `INSERT INTO alert_rules (
            metric_name, operator, threshold, duration,
            is_active, user_id, host_id
         )
         SELECT $1, $2, $3, $4, $5, $6, $7
         WHERE $7::integer IS NULL
            OR EXISTS (
                SELECT 1 FROM hosts
                WHERE id = $7 AND user_id = $6
            )
         RETURNING *`,
        [
            rule.metric_name,
            rule.operator,
            rule.threshold,
            rule.duration,
            rule.is_active,
            userId,
            rule.host_id
        ]
    );

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

    const fields = allowedFields.filter(field =>
        Object.prototype.hasOwnProperty.call(updates, field)
    );

    if (fields.length === 0) {
        return null;
    }

    const values = fields.map(field => updates[field]);
    const assignments = fields.map(
        (field, index) => `${field} = $${index + 1}`
    );

    values.push(id, userId);

    let ownershipCondition = '';

    if (Object.prototype.hasOwnProperty.call(updates, 'host_id')) {
        values.push(updates.host_id);
        const hostParam = `$${values.length}`;
        const userParam = `$${fields.length + 2}`;

        ownershipCondition = `
            AND (
                ${hostParam}::integer IS NULL
                OR EXISTS (
                    SELECT 1 FROM hosts
                    WHERE id = ${hostParam} AND user_id = ${userParam}
                )
            )
        `;
    }

    const result = await pool.query(
        `UPDATE alert_rules
         SET ${assignments.join(', ')}
         WHERE id = $${fields.length + 1}
           AND user_id = $${fields.length + 2}
           ${ownershipCondition}
         RETURNING *`,
        values
    );

    return result.rows[0] || null;
}

async function deleteRule(id, userId) {
    const result = await pool.query(
        `DELETE FROM alert_rules
         WHERE id = $1 AND user_id = $2
         RETURNING id`,
        [id, userId]
    );

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
