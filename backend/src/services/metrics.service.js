const pool = require('../config/db');

const intervalMap = {
    '1m': '1 minute',
    '5m': '5 minutes',
    '15m': '15 minutes',
    '1h': '1 hour'
};

const fetchMetrics = async (range) => {

    const interval =
        intervalMap[range] || '1 minute';

    const result = await pool.query(`
        SELECT *
        FROM metrics
        WHERE timestamp >= NOW() - INTERVAL '${interval}'
        ORDER BY timestamp ASC
    `);

    return result.rows;

};

const fetchLatestMetric = async () => {

    const result = await pool.query(`
        SELECT *
        FROM metrics
        ORDER BY timestamp DESC
        LIMIT 1
    `);

    return result.rows[0];

};

module.exports = {
    fetchMetrics,
    fetchLatestMetric
};