const pool = require('../config/db');

// anomaly.service.js — fix the signature
async function checkAnomaly(metricName, currentValue) {
  try {
    const result = await pool.query(
      `SELECT AVG(${metricName}) AS avg FROM metrics`
    );
    const avg = parseFloat(result.rows[0].avg) || 0;

    if (avg > 0 && currentValue > avg * 1.5) {
      await pool.query(
        `INSERT INTO alerts (metric_name, metric_value, average_value)
         VALUES ($1, $2, $3)`,
        [metricName, currentValue, avg]
      );
      console.log(`Alert created for ${metricName}: ${currentValue.toFixed(2)} vs avg ${avg.toFixed(2)}`);
    }
  } catch (err) {
    console.error('Anomaly detection error:', err);
  }
}

module.exports = checkAnomaly;