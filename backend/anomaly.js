 const pool = require('./db');

const checkAnomaly = async (metricName, currentValue) => {
  try {
    // Get last 10 readings of this metric
    const result = await pool.query(
      `SELECT ${metricName} FROM metrics 
       ORDER BY timestamp DESC LIMIT 10`
    );

    if (result.rows.length < 10) return; // not enough data yet

    // Calculate average of last 10 readings
    const values = result.rows.map(row => parseFloat(row[metricName]));
    const average = values.reduce((sum, val) => sum + val, 0) / values.length;

    // Calculate deviation
    const deviation = currentValue - average;
    const deviationPercent = (deviation / average) * 100;

    // If current value is 40% above average — anomaly detected
    if (deviationPercent > 40) {
      console.log(`⚠️  ANOMALY DETECTED — ${metricName}: ${currentValue.toFixed(2)} (avg: ${average.toFixed(2)})`);

      // Save alert to database
      await pool.query(
        `INSERT INTO alerts (metric_name, metric_value, average_value)
         VALUES ($1, $2, $3)`,
        [metricName, currentValue, average]
      );
    }

  } catch (err) {
    console.error('Anomaly detection error:', err);
  }
};

module.exports = checkAnomaly;