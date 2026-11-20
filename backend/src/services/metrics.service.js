const pool = require('../config/db');
const metricsQueryService = require('./metricsQuery.service');

// Short ranges return raw samples. The map below is a fixed internal value,
// never user input, so it is safe to interpolate into the SQL.
const RAW_RANGES = {
    '1m': '1 minute',
    '5m': '5 minutes',
    '15m': '15 minutes',
    '1h': '1 hour'
};

// Longer ranges are built by the same mixed raw / 5-minute / hourly query
// engine as /api/metrics/query, so the newest minutes are never missing, and
// are returned in these bucket sizes.
const LONG_RANGES = {
    '6h':  { ms: 6 * 60 * 60 * 1000,       step: '5m' },
    '24h': { ms: 24 * 60 * 60 * 1000,      step: '5m' },
    '3d':  { ms: 3 * 24 * 60 * 60 * 1000,  step: '15m' },
    '7d':  { ms: 7 * 24 * 60 * 60 * 1000,  step: '1h' },
    '30d': { ms: 30 * 24 * 60 * 60 * 1000, step: '1h' },
    '90d': { ms: 90 * 24 * 60 * 60 * 1000, step: '1h' }
};

const LONG_RANGE_METRICS = [
    'cpu_usage',
    'memory_usage',
    'disk_usage',
    'network_in',
    'network_out'
];

const isSupportedRange = (range) => {
    return (
        Object.prototype.hasOwnProperty.call(RAW_RANGES, range) ||
        Object.prototype.hasOwnProperty.call(LONG_RANGES, range)
    );
};
const verifyHostOwnership = async (hostId, userId) => {

    const result = await pool.query(
        `SELECT id FROM hosts WHERE id = $1 AND user_id = $2`,
        [hostId, userId]
    );

    return result.rows.length > 0;
};

// Builds one row per bucket carrying the average under the plain metric name
// (as raw rows do) plus <name>_min / <name>_max and sample_count, so short
// spikes stay visible on long ranges.
const fetchLongRange = async (range, hostId, now = Date.now()) => {
    const { ms, step } = LONG_RANGES[range];
    const stepMs = metricsQueryService.QUERY_STEP_MS[step];

    const from = new Date(Math.floor((now - ms) / stepMs) * stepMs);
    const to = new Date(now);
    const sources = metricsQueryService.getQuerySources(from, to, now);

    const query = (agg) => metricsQueryService.fetchMetricQuery({
        hostIds: [hostId],
        from,
        to,
        step,
        agg,
        sources
    });

    const [avgRows, minRows, maxRows] = await Promise.all([
        query('avg'),
        query('min'),
        query('max')
    ]);

    const keyOf = (row) => new Date(row.timestamp).getTime();
    const minByTime = new Map(minRows.map((row) => [keyOf(row), row]));
    const maxByTime = new Map(maxRows.map((row) => [keyOf(row), row]));

    return avgRows.map((row) => {
        const minRow = minByTime.get(keyOf(row));
        const maxRow = maxByTime.get(keyOf(row));
        const merged = { ...row };

        for (const metric of LONG_RANGE_METRICS) {
            merged[`${metric}_min`] = minRow ? minRow[metric] : null;
            merged[`${metric}_max`] = maxRow ? maxRow[metric] : null;
        }

        return merged;
    });
};

const fetchMetrics = async (range, hostId) => {

    if (LONG_RANGES[range]) {
        return fetchLongRange(range, hostId);
    }

    const interval = RAW_RANGES[range] || '1 minute';

    // Raw rows are placed by the agent's collection time when it sent one
    const result = await pool.query(
        `SELECT *
         FROM metrics
         WHERE host_id = $1
           AND COALESCE(collected_at, timestamp) >= NOW() - INTERVAL '${interval}'
         ORDER BY COALESCE(collected_at, timestamp) ASC`,
        [hostId]
    );

    return result.rows;
};

const fetchLatestMetric = async (hostId) => {

    const result = await pool.query(
        `SELECT *
         FROM metrics
         WHERE host_id = $1
         ORDER BY COALESCE(collected_at, timestamp) DESC
         LIMIT 1`,
        [hostId]
    );

    return result.rows[0];
};

module.exports = {
    isSupportedRange,
    verifyHostOwnership,
    fetchMetrics,
    fetchLatestMetric
};