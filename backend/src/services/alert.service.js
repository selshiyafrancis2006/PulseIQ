const pool = require('../config/db');

// store consecutive breaches in memory, keyed per host+metric so one
// host's breach streak never affects another host's
const breachState = new Map();

function breachKey(hostId, metricName) {
    return `${hostId ?? 'unknown'}:${metricName}`;
}

async function evaluateAlerts(metric) {
    try {

       const rulesResult = await pool.query(`
    SELECT *
    FROM alert_rules
    WHERE is_active = true
      AND user_id = (
          SELECT user_id
          FROM hosts
          WHERE id = $1
      )
`, [metric.host_id]);

        const rules = rulesResult.rows;

        for (const rule of rules) {

            const value = metric[rule.metric_name];

            if (value === undefined) continue;

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
            }

            const key = breachKey(metric.host_id, rule.metric_name);

            if (conditionMet) {

                const count = (breachState.get(key) || 0) + 1;
                breachState.set(key, count);

                if (count >= rule.duration) {

                   const severity =
    value >= 90
        ? "Critical"
        : "Warning";


await pool.query(`
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
    value,
    rule.threshold,
    severity,
    metric.host_id ?? null
]);

                    console.log(`Alert triggered: ${rule.metric_name} (host_id: ${metric.host_id ?? 'unknown'})`);

                    breachState.set(key, 0);
                }

            } else {
                breachState.set(key, 0);
            }
        }

    } catch (err) {
        console.error("Alert engine error:", err);
    }
}

async function fetchAlerts(hostId, userId) {

    const result = await pool.query(`
        SELECT a.*
        FROM alerts a
        JOIN hosts h ON h.id = a.host_id
        WHERE h.id = $1
          AND h.user_id = $2
        ORDER BY a.timestamp DESC
        LIMIT 20
    `, [hostId, userId]);

    return result.rows.map(alert => ({

        id: alert.id,

        metric_name: alert.metric_name,

        current_value: alert.metric_value,

        threshold_value: alert.average_value,

        host_id: alert.host_id,

        severity:
    alert.severity ||
    (
        alert.metric_value >= 90
            ? "Critical"
            : "Warning"
    ),

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