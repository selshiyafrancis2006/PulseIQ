const pool = require('../config/db');

// Raw metrics are kept for 3 days, so longer ranges are served from the
// rollup tables: 5-minute buckets up to 24h, 1-hour buckets beyond that.
// The maps below are fixed internal values, never user input, so they are
// safe to interpolate into the SQL.
const RAW_RANGES = {
    '1m': '1 minute',
    '5m': '5 minutes',
    '15m': '15 minutes',
    '1h': '1 hour'
};

const ROLLUP_5M_RANGES = {
    '6h': '6 hours',
    '24h': '24 hours'
};

const ROLLUP_1H_RANGES = {
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

// Rollup rows are renamed to the raw column names (using each bucket's
// average) so every chart and table that reads raw metrics works unchanged.
const fetchRollup = async (table, interval, hostId) => {

    const result = await pool.query(
        `SELECT
            id,
            host_id,
            bucket_start AS timestamp,
            cpu_usage_avg AS cpu_usage,
            memory_usage_avg AS memory_usage,
            disk_usage_avg AS disk_usage,
            network_in_avg AS network_in,
            network_out_avg AS network_out
         FROM ${table}
         WHERE host_id = $1
           AND bucket_start >= NOW() - INTERVAL '${interval}'
         ORDER BY bucket_start ASC`,
        [hostId]
    );

    return result.rows;
};

const fetchMetrics = async (range, hostId) => {

    if (ROLLUP_5M_RANGES[range]) {
        return fetchRollup('metric_rollups_5m', ROLLUP_5M_RANGES[range], hostId);
    }

    if (ROLLUP_1H_RANGES[range]) {
        return fetchRollup('metric_rollups_1h', ROLLUP_1H_RANGES[range], hostId);
    }

    const interval = RAW_RANGES[range] || '1 minute';

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

const fetchLatestMetric = async (hostId) => {

    const result = await pool.query(
        `SELECT *
         FROM metrics
         WHERE host_id = $1
         ORDER BY timestamp DESC
         LIMIT 1`,
        [hostId]
    );

    return result.rows[0];
};

module.exports = {
    verifyHostOwnership,
    fetchMetrics,
    fetchLatestMetric
};