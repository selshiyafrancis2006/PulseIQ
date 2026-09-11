const pool = require('../config/db');

const verifyHostOwnership = async (hostId, userId) => {

    const result = await pool.query(
        'SELECT id FROM hosts WHERE id = $1 AND user_id = $2',
        [hostId, userId]
    );

    return result.rows.length > 0;
};

const fetchAnomalies = async (hostId, limit = 50) => {

    const result = await pool.query(
        `SELECT id, metric_name, value, baseline_mean, baseline_stddev, deviation_score, timestamp
         FROM anomalies
         WHERE host_id = $1
         ORDER BY timestamp DESC
         LIMIT $2`,
        [hostId, limit]
    );

    return result.rows;
};

module.exports = {
    verifyHostOwnership,
    fetchAnomalies
};