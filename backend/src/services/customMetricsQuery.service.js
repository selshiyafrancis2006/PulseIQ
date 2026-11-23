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

    if (!interval || !aggregateExpression) {
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

    const result = await pool.query(
        `
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
          AND collected_at >= $4
          AND collected_at < $5
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
        SELECT
            metric_name,
            unit,
            MAX(collected_at) AS latest_sample_timestamp,
            COUNT(*)::INTEGER AS sample_count
        FROM custom_metrics
        WHERE host_id = $1
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

