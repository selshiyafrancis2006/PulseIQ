const pool = require('../config/db');

const verifyHostOwnership = async (hostId, userId) => {

    const result = await pool.query(
        'SELECT id FROM hosts WHERE id = $1 AND user_id = $2',
        [hostId, userId]
    );

    return result.rows.length > 0;
};

const fetchTraces = async (hostId, limit = 100) => {

    const result = await pool.query(
        `SELECT id, method, route, status_code, duration_ms, timestamp
         FROM traces
         WHERE host_id = $1
         ORDER BY timestamp DESC
         LIMIT $2`,
        [hostId, limit]
    );

    return result.rows;
};

const fetchRouteSummary = async (hostId) => {

    const result = await pool.query(
        `SELECT
            method,
            route,
            COUNT(*) AS request_count,
            ROUND(AVG(duration_ms)::numeric, 1) AS avg_duration_ms,
            MAX(duration_ms) AS max_duration_ms,
            COUNT(*) FILTER (WHERE status_code >= 400) AS error_count
         FROM traces
         WHERE host_id = $1
           AND timestamp >= NOW() - INTERVAL '1 hour'
         GROUP BY method, route
         ORDER BY avg_duration_ms DESC`,
        [hostId]
    );

    return result.rows;
};

module.exports = {
    verifyHostOwnership,
    fetchTraces,
    fetchRouteSummary
};