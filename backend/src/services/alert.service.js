
const pool = require('../config/db');

function getAlertSeverity(metricName, value) {
    const percentageMetrics = new Set([
        'cpu_usage',
        'memory_usage',
        'disk_usage'
    ]);

    if (percentageMetrics.has(metricName) && value >= 90) {
        return 'Critical';
    }

    return 'Warning';
}


async function evaluateAlerts(metric) {
    let client;

    try {
        client = await pool.connect();
        await client.query('BEGIN');

        const rulesResult = await client.query(`
            SELECT ar.*
            FROM alert_rules ar
            JOIN hosts h ON h.user_id = ar.user_id
            WHERE h.id = $1
              AND ar.is_active = true
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
            }
        }

        await client.query('COMMIT');

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
        WHERE h.id = $1
          AND h.user_id = $2
        ORDER BY a.timestamp DESC, a.id DESC
        LIMIT $3 OFFSET $4
    `, [hostId, userId, limit, offset]);

    return result.rows.map(alert => ({
        id: alert.id,
        metric_name: alert.metric_name,
        current_value: alert.metric_value,
        threshold_value: alert.average_value,
        host_id: alert.host_id,
        severity: alert.severity || getAlertSeverity(alert.metric_name, alert.metric_value),
        timestamp: alert.timestamp
    }));
}

async function fetchRules(userId) {
    const result = await pool.query(
        `SELECT * FROM alert_rules WHERE user_id = $1 ORDER BY id ASC`,
        [userId]
    );
    return result.rows;
}

async function updateRule(id, userId, threshold, is_active) {
    const result = await pool.query(
        `UPDATE alert_rules
         SET threshold = $1, is_active = $2
         WHERE id = $3 AND user_id = $4
         RETURNING *`,
        [threshold, is_active, id, userId]
    );
    return result.rows[0] || null;
}

module.exports = { evaluateAlerts, fetchAlerts, fetchRules, updateRule };
