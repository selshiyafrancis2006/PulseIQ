const pool = require('../config/db');

const verifyHostOwnership = async (hostId, userId) => {

    const result = await pool.query(
        'SELECT id FROM hosts WHERE id = $1 AND user_id = $2',
        [hostId, userId]
    );

    return result.rows.length > 0;
};

// Column each sort option orders by. Values come from this map, never from
// the request, so the ORDER BY clause is not injectable.
const SORT_COLUMNS = {
    timestamp: 'timestamp',
    duration: 'duration_ms',
    status: 'status_code'
};

// WHERE fragments for each status filter ("error" is any 4xx or 5xx).
const STATUS_CONDITIONS = {
    '2xx': 'status_code >= 200 AND status_code < 300',
    '3xx': 'status_code >= 300 AND status_code < 400',
    '4xx': 'status_code >= 400 AND status_code < 500',
    '5xx': 'status_code >= 500',
    error: 'status_code >= 400'
};

// Builds the shared WHERE clause and its parameters (host_id is $1).
const buildTraceFilter = (hostId, { rangeSeconds, method, route, status, minDurationMs }) => {

    const params = [hostId, rangeSeconds];
    const conditions = [
        'host_id = $1',
        "timestamp >= NOW() - make_interval(secs => $2::double precision)"
    ];

    if (method) {
        params.push(method);
        conditions.push(`method = $${params.length}`);
    }

    if (route) {
        params.push(route);
        conditions.push(`route = $${params.length}`);
    }

    if (status) {
        conditions.push(STATUS_CONDITIONS[status]);
    }

    if (minDurationMs !== null && minDurationMs !== undefined) {
        params.push(minDurationMs);
        conditions.push(`duration_ms >= $${params.length}`);
    }

    return { where: conditions.join(' AND '), params };
};

// One page of requests. Powers "latest", "slowest" (sort=duration) and
// "failing" (status=5xx or error) with the same filters.
const fetchTraces = async (hostId, options = {}) => {

    const {
        rangeSeconds = 3600,
        sort = 'timestamp',
        order = 'desc',
        page = 1,
        pageSize = 25
    } = options;

    const { where, params } = buildTraceFilter(hostId, { ...options, rangeSeconds });

    const direction = order === 'asc' ? 'ASC' : 'DESC';
    const sortColumn = SORT_COLUMNS[sort] || SORT_COLUMNS.timestamp;

    const [rows, count] = await Promise.all([
        pool.query(
            `SELECT id, method, route, status_code, duration_ms, timestamp
             FROM traces
             WHERE ${where}
             ORDER BY ${sortColumn} ${direction} NULLS LAST, id DESC
             LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
            [...params, pageSize, (page - 1) * pageSize]
        ),
        pool.query(`SELECT COUNT(*) AS total FROM traces WHERE ${where}`, params)
    ]);

    const total = Number(count.rows[0].total);

    return {
        items: rows.rows,
        page,
        page_size: pageSize,
        total,
        total_pages: Math.max(1, Math.ceil(total / pageSize))
    };
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
const fetchTimeSeries = async (hostId, rangeSeconds, bucketSeconds, route = null) => {

    const { method = null, route: routePath = null } = route || {};

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
              AND ($4::text IS NULL OR t.method = $4)
              AND ($5::text IS NULL OR t.route = $5)
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
        [hostId, rangeSeconds, bucketSeconds, method, routePath]
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

// Everything the route drill-down shows: stats, a status-code breakdown and
// the route's own time series.
const fetchRouteDetail = async (hostId, method, route, rangeSeconds, bucketSeconds) => {

    const [stats, statuses, points] = await Promise.all([
        pool.query(
            `SELECT ${LATENCY_AND_ERROR_COLUMNS}
             FROM traces
             WHERE host_id = $1
               AND method = $3
               AND route = $4
               AND timestamp >= NOW() - make_interval(secs => $2::double precision)`,
            [hostId, rangeSeconds, method, route]
        ),
        pool.query(
            `SELECT status_code, COUNT(*) AS request_count
             FROM traces
             WHERE host_id = $1
               AND method = $3
               AND route = $4
               AND timestamp >= NOW() - make_interval(secs => $2::double precision)
             GROUP BY status_code
             ORDER BY status_code NULLS LAST`,
            [hostId, rangeSeconds, method, route]
        ),
        fetchTimeSeries(hostId, rangeSeconds, bucketSeconds, { method, route })
    ]);

    const summary = normalizeStats(stats.rows[0]);

    return {
        method,
        route,
        ...summary,
        throughput_rpm: Number(((summary.request_count / rangeSeconds) * 60).toFixed(2)),
        status_codes: statuses.rows.map((row) => ({
            status_code: row.status_code,
            request_count: toNumber(row.request_count)
        })),
        points
    };
};

module.exports = {
    verifyHostOwnership,
    fetchTraces,
    fetchRouteSummary,
    fetchOverview,
    fetchTimeSeries,
    fetchRouteDetail
};