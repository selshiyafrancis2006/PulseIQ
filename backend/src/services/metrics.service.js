const pool = require('../config/db');

const intervalMap = {
    '1m': '1 minute',
    '5m': '5 minutes',
    '15m': '15 minutes',
    '1h': '1 hour',
    '6h': '6 hours',
    '24h': '24 hours',
    '3d': '3 days',
    '7d': '7 days'
};

const verifyHostOwnership = async (hostId, userId) => {

    const result = await pool.query(
        `SELECT id FROM hosts WHERE id = $1 AND user_id = $2`,
        [hostId, userId]
    );

    return result.rows.length > 0;
};

const fetchMetrics = async (range, hostId) => {

    const interval = intervalMap[range] || '1 minute';

    const result = await pool.query(
        `SELECT *
         FROM metrics
         WHERE host_id = $1
           AND timestamp >= NOW() - INTERVAL '${interval}'
         ORDER BY timestamp ASC`,
        [hostId]
    );

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
    verifyHostOwnership,
    fetchMetrics,
    fetchLatestMetric
};