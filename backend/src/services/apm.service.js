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

// pg returns numeric / bigint columns as strings; the API sends numbers.
const toNumber = (value) => (value === null || value === undefined ? null : Number(value));

// Error rate counts server errors (5xx) only: a 404 or 401 is the client's
// problem, not the service failing. Client errors are reported separately.
// Aggregates shared by the per-route summary, the overview and the series.
const LATENCY_AND_ERROR_COLUMNS = `
    COUNT(*) AS request_count,
    ROUND(AVG(duration_ms)::numeric, 1) AS avg_duration_ms,
    MAX(duration_ms) AS max_duration_ms,
    ROUND((percentile_cont(0.5) WITHIN GROUP (ORDER BY duration_ms))::numeric, 1) AS p50_duration_ms,
    ROUND((percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms))::numeric, 1) AS p95_duration_ms,
    ROUND((percentile_cont(0.99) WITHIN GROUP (ORDER BY duration_ms))::numeric, 1) AS p99_duration_ms,
    COUNT(*) FILTER (WHERE status_code >= 500) AS error_count,
    COUNT(*) FILTER (WHERE status_code >= 400 AND status_code < 500) AS client_error_count,
    ROUND(100.0 * COUNT(*) FILTER (WHERE status_code >= 500) / NULLIF(COUNT(*), 0), 2) AS error_rate`;

const normalizeStats = (row) => ({
    request_count: toNumber(row.request_count),
    avg_duration_ms: toNumber(row.avg_duration_ms),
    max_duration_ms: toNumber(row.max_duration_ms),
    p50_duration_ms: toNumber(row.p50_duration_ms),
    p95_duration_ms: toNumber(row.p95_duration_ms),
    p99_duration_ms: toNumber(row.p99_duration_ms),
    error_count: toNumber(row.error_count),
    client_error_count: toNumber(row.client_error_count),
    error_rate: toNumber(row.error_rate)
});

// Per-route latency percentiles and error rate over the last `rangeSeconds`.
// Slowest routes (by p95) come first.
const fetchRouteSummary = async (hostId, rangeSeconds = 3600) => {

    const result = await pool.query(
        `SELECT
            method,
            route,
            ${LATENCY_AND_ERROR_COLUMNS}
         FROM traces
         WHERE host_id = $1
           AND timestamp >= NOW() - make_interval(secs => $2::double precision)
         GROUP BY method, route
         ORDER BY p95_duration_ms DESC NULLS LAST, request_count DESC`,
        [hostId, rangeSeconds]
    );

    return result.rows.map((row) => ({
        method: row.method,
        route: row.route,
        ...normalizeStats(row)
    }));
};

// Host-wide totals for the range. Percentiles cannot be rebuilt from the
// per-route rows, so they are computed over every request here.
const fetchOverview = async (hostId, rangeSeconds = 3600) => {

    const result = await pool.query(
        `SELECT ${LATENCY_AND_ERROR_COLUMNS}
         FROM traces
         WHERE host_id = $1
           AND timestamp >= NOW() - make_interval(secs => $2::double precision)`,
        [hostId, rangeSeconds]
    );

    const stats = normalizeStats(result.rows[0]);

    return {
        ...stats,
        throughput_rpm: Number(((stats.request_count / rangeSeconds) * 60).toFixed(2))
    };
};

// Latency, throughput and error rate per fixed-width bucket (date_bin).
// Buckets with no traffic are kept (zero requests, null latency) so charts
// show a gap instead of joining the points either side of it.
const fetchTimeSeries = async (hostId, rangeSeconds, bucketSeconds) => {

    const result = await pool.query(
        `WITH params AS (
            SELECT make_interval(secs => $3::double precision) AS width,
                   TIMESTAMPTZ '2000-01-01 00:00:00+00' AS origin
         ),
         bounds AS (
            SELECT date_bin(width, NOW() - make_interval(secs => $2::double precision), origin) AS start_at,
                   date_bin(width, NOW(), origin) AS end_at
            FROM params
         ),
         buckets AS (
            SELECT generate_series(b.start_at, b.end_at, p.width) AS bucket
            FROM bounds b, params p
         ),
         agg AS (
            SELECT date_bin(p.width, t.timestamp, p.origin) AS bucket,
                   ${LATENCY_AND_ERROR_COLUMNS}
            FROM traces t, params p, bounds b
            WHERE t.host_id = $1
              AND t.timestamp >= b.start_at
            GROUP BY 1
         )
         SELECT buckets.bucket,
                COALESCE(agg.request_count, 0) AS request_count,
                agg.avg_duration_ms,
                agg.max_duration_ms,
                agg.p50_duration_ms,
                agg.p95_duration_ms,
                agg.p99_duration_ms,
                COALESCE(agg.error_count, 0) AS error_count,
                COALESCE(agg.client_error_count, 0) AS client_error_count,
                agg.error_rate
         FROM buckets
         LEFT JOIN agg ON agg.bucket = buckets.bucket
         ORDER BY buckets.bucket`,
        [hostId, rangeSeconds, bucketSeconds]
    );

    return result.rows.map((row) => {
        const stats = normalizeStats(row);

        return {
            bucket: row.bucket,
            ...stats,
            throughput_rpm: Number(((stats.request_count / bucketSeconds) * 60).toFixed(2))
        };
    });
};

module.exports = {
    verifyHostOwnership,
    fetchTraces,
    fetchRouteSummary,
    fetchOverview,
    fetchTimeSeries
};