const pool = require('../config/db');

const MAX_CUSTOM_QUERY_ROWS = 10000;

const QUERY_STEPS = {
    '1m': '1 minute',
    '5m': '5 minutes',
    '15m': '15 minutes',
    '1h': '1 hour',
    '6h': '6 hours',
    '1d': '1 day'
};

const AGGREGATIONS = {
    avg: 'AVG(value)',
    min: 'MIN(value)',
    max: 'MAX(value)'
};

const ROLLUP_AGGREGATIONS = {
    avg: 'SUM(value_avg * sample_count) / NULLIF(SUM(sample_count), 0)',
    min: 'MIN(value_min)',
    max: 'MAX(value_max)'
};

function validateHistoricalResolution(from, step) {
    const fromTime = new Date(from).getTime();

    if (!Number.isFinite(fromTime)) {
        throw new TypeError('Invalid custom metric query date range');
    }

    const age = Date.now() - fromTime;
    const threeDays = 3 * 24 * 60 * 60 * 1000;
    const eightDays = 8 * 24 * 60 * 60 * 1000;

    if (age > threeDays && step === '1m') {
        throw new TypeError(
            'Historical custom metrics have a minimum resolution of 5 minutes'
        );
    }

    if (
        age > eightDays &&
        ['1m', '5m', '15m'].includes(step)
    ) {
        throw new TypeError(
            'Custom metrics older than 8 days have a minimum resolution of 1 hour'
        );
    }
}

async function fetchCustomMetricQuery({
    hostId,
    metricName,
    from,
    to,
    step,
    aggregation,
    limit = MAX_CUSTOM_QUERY_ROWS + 1
}) {
    const interval = QUERY_STEPS[step];
    const aggregateExpression = AGGREGATIONS[aggregation];
    const rollupExpression = ROLLUP_AGGREGATIONS[aggregation];
    const combinedExpression = aggregation === 'avg'
        ? 'SUM(value * sample_count) / NULLIF(SUM(sample_count), 0)'
        : aggregation === 'min'
            ? 'MIN(value)'
            : 'MAX(value)';

    if (!interval || !aggregateExpression || !rollupExpression) {
        throw new TypeError('Invalid custom metric query configuration');
    }

    if (
        !Number.isSafeInteger(hostId) ||
        hostId < 1 ||
        typeof metricName !== 'string' ||
        !/^[a-zA-Z][a-zA-Z0-9_.-]{0,99}$/.test(metricName) ||
        !Number.isSafeInteger(limit) ||
        limit < 1 ||
        limit > MAX_CUSTOM_QUERY_ROWS + 1
    ) {
        throw new TypeError('Invalid custom metric query parameters');
    }

    validateHistoricalResolution(from, step);

    const result = await pool.query(
        `
        WITH raw_data AS (
            SELECT
                date_bin(
                    $1::interval,
                    collected_at,
                    TIMESTAMPTZ '1970-01-01 00:00:00+00'
                ) AS timestamp,
                unit,
                tags,
                ${aggregateExpression} AS value,
                COUNT(*)::INTEGER AS sample_count,
                MAX(collected_at) AS latest_sample_timestamp
            FROM custom_metrics
            WHERE host_id = $2
              AND metric_name = $3
              AND collected_at >= GREATEST(
                    $4::timestamptz,
                    date_bin(
                        INTERVAL '5 minutes',
                        NOW() - INTERVAL '3 days',
                        TIMESTAMPTZ '1970-01-01 00:00:00+00'
                    ) + INTERVAL '5 minutes'
              )
              AND collected_at < LEAST($5::timestamptz, NOW())
            GROUP BY timestamp, unit, tags
        ),
        five_minute_data AS (
            SELECT
                date_bin(
                    $1::interval,
                    bucket_start,
                    TIMESTAMPTZ '1970-01-01 00:00:00+00'
                ) AS timestamp,
                unit,
                tags,
                ${rollupExpression} AS value,
                SUM(sample_count)::INTEGER AS sample_count,
                MAX(bucket_start + INTERVAL '5 minutes')
                    AS latest_sample_timestamp
            FROM metric_rollups_5m_generic
            WHERE host_id = $2
              AND metric_name = $3
              AND bucket_start >= GREATEST(
                    $4::timestamptz,
                    date_trunc('hour', NOW() - INTERVAL '8 days')
              )
              AND bucket_start < LEAST(
                    $5::timestamptz,
                    date_bin(
                        INTERVAL '5 minutes',
                        NOW() - INTERVAL '3 days',
                        TIMESTAMPTZ '1970-01-01 00:00:00+00'
                    ) + INTERVAL '5 minutes'
              )
            GROUP BY timestamp, unit, tags
        ),
        hourly_data AS (
            SELECT
                date_bin(
                    $1::interval,
                    bucket_start,
                    TIMESTAMPTZ '1970-01-01 00:00:00+00'
                ) AS timestamp,
                unit,
                tags,
                ${rollupExpression} AS value,
                SUM(sample_count)::INTEGER AS sample_count,
                MAX(bucket_start + INTERVAL '1 hour')
                    AS latest_sample_timestamp
            FROM metric_rollups_1h_generic
            WHERE host_id = $2
              AND metric_name = $3
              AND bucket_start >= $4::timestamptz
              AND bucket_start < LEAST(
                    $5::timestamptz,
                    date_trunc('hour', NOW() - INTERVAL '8 days')
              )
            GROUP BY timestamp, unit, tags
        ),
        combined AS (
            SELECT * FROM raw_data
            UNION ALL
            SELECT * FROM five_minute_data
            UNION ALL
            SELECT * FROM hourly_data
        )
        SELECT
            timestamp,
            unit,
            tags,
            ${combinedExpression} AS value,
            SUM(sample_count)::INTEGER AS sample_count,
            MAX(latest_sample_timestamp) AS latest_sample_timestamp
        FROM combined
        GROUP BY timestamp, unit, tags
        ORDER BY timestamp ASC, tags ASC
        LIMIT $6
        `,
        [
            interval,
            hostId,
            metricName,
            from,
            to,
            limit
        ]
    );

    return result.rows;
}

async function fetchCustomMetricNames(hostId) {
    if (!Number.isSafeInteger(hostId) || hostId < 1) {
        throw new TypeError('Invalid custom metric host ID');
    }

    const result = await pool.query(
        `
        WITH metric_sources AS (
            SELECT
                metric_name,
                unit,
                MAX(collected_at) AS latest_sample_timestamp,
                COUNT(*)::BIGINT AS sample_count
            FROM custom_metrics
            WHERE host_id = $1
              AND collected_at >= date_bin(
                    INTERVAL '5 minutes',
                    NOW() - INTERVAL '3 days',
                    TIMESTAMPTZ '1970-01-01 00:00:00+00'
                  ) + INTERVAL '5 minutes'
            GROUP BY metric_name, unit

            UNION ALL

            SELECT
                metric_name,
                unit,
                MAX(bucket_start + INTERVAL '5 minutes'),
                SUM(sample_count)::BIGINT
            FROM metric_rollups_5m_generic
            WHERE host_id = $1
              AND bucket_start >= date_trunc(
                    'hour',
                    NOW() - INTERVAL '8 days'
                  )
              AND bucket_start < date_bin(
                    INTERVAL '5 minutes',
                    NOW() - INTERVAL '3 days',
                    TIMESTAMPTZ '1970-01-01 00:00:00+00'
                  ) + INTERVAL '5 minutes'
            GROUP BY metric_name, unit

            UNION ALL

            SELECT
                metric_name,
                unit,
                MAX(bucket_start + INTERVAL '1 hour'),
                SUM(sample_count)::BIGINT
            FROM metric_rollups_1h_generic
            WHERE host_id = $1
              AND bucket_start < date_trunc(
                    'hour',
                    NOW() - INTERVAL '8 days'
                  )
            GROUP BY metric_name, unit
        )
        SELECT
            metric_name,
            unit,
            MAX(latest_sample_timestamp) AS latest_sample_timestamp,
            SUM(sample_count)::INTEGER AS sample_count
        FROM metric_sources
        GROUP BY metric_name, unit
        ORDER BY metric_name ASC, unit ASC
        LIMIT 500
        `,
        [hostId]
    );

    return result.rows;
}

module.exports = {
    MAX_CUSTOM_QUERY_ROWS,
    QUERY_STEPS,
    AGGREGATIONS,
    fetchCustomMetricQuery,
    fetchCustomMetricNames
};

