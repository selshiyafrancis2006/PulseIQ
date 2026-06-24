const pool = require('../config/db');

// store consecutive breaches in memory
const breachState = new Map();

async function evaluateAlerts(metric) {
    try {

        const rulesResult = await pool.query(`
            SELECT * FROM alert_rules WHERE is_active = true
        `);

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

            const key = rule.metric_name;

            if (conditionMet) {

                const count = (breachState.get(key) || 0) + 1;
                breachState.set(key, count);

                if (count >= rule.duration) {

                    await pool.query(`
                        INSERT INTO alerts (
                            metric_name,
                            metric_value,
                            average_value,
                            timestamp
                        )
                        VALUES ($1, $2, $3, NOW())
                    `, [
                        rule.metric_name,
                        value,
                        rule.threshold
                    ]);

                    console.log(`🚨 Alert triggered: ${rule.metric_name}`);

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
async function fetchAlerts() {
  const result = await pool.query(
    `SELECT * FROM alerts ORDER BY timestamp DESC LIMIT 20`
  );
  return result.rows;
}
module.exports = { evaluateAlerts, fetchAlerts };