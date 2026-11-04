const pool = require('../config/db');

const DAY_MS = 24 * 60 * 60 * 1000;

const QUERY_STEPS = {
    '1m': '1 minute',
    '5m': '5 minutes',
    '15m': '15 minutes',
    '1h': '1 hour',
    '6h': '6 hours',
    '1d': '1 day'
};

const QUERY_STEP_MS = {
    '1m': 60 * 1000,
    '5m': 5 * 60 * 1000,
    '15m': 15 * 60 * 1000,
    '1h': 60 * 60 * 1000,
    '6h': 6 * 60 * 60 * 1000,
    '1d': DAY_MS
};

const isStepCompatible = (step, source) => {
    return (
        Object.prototype.hasOwnProperty.call(QUERY_STEP_MS, step) &&
        QUERY_STEP_MS[step] >= source.resolutionMs
    );
};

const METRICS = [
    'cpu_usage',
    'memory_usage',
    'disk_usage',
    'network_in',
    'network_out'
];

const getQuerySource = (from) => {
    const age = Date.now() - from.getTime();

    if (age <= 3 * DAY_MS) {
        return {
            table: 'metrics',
            resolutionMs: 60 * 1000,
            type: 'raw'
        };
    }

    if (age <= 8 * DAY_MS) {
        return {
            table: 'metric_rollups_5m',
            resolutionMs: 5 * 60 * 1000,
            type: '5m'
        };
    }

    return {
        table: 'metric_rollups_1h',
        resolutionMs: 60 * 60 * 1000,
        type: '1h'
    };
};

const getRawAggregate = (metric, agg) => {
    if (agg === 'avg') return `AVG(${metric})`;
    if (agg === 'min') return `MIN(${metric})`;
    if (agg === 'max') return `MAX(${metric})`;

    return `percentile_cont(0.95) WITHIN GROUP (ORDER BY ${metric})`;
};

const getRollupAggregate = (metric, agg) => {
    if (agg === 'avg') {
        return `SUM(${metric}_avg * sample_count)::double precision
                / NULLIF(SUM(sample_count), 0)`;
    }

    if (agg === 'min') return `MIN(${metric}_min)`;
    if (agg === 'max') return `MAX(${metric}_max)`;

    throw new Error('P95 aggregation is only supported for raw metrics');
};

const verifyHostsOwnership = async (hostIds, userId) => {
    const result = await pool.query(
        `SELECT id
         FROM hosts
         WHERE id = ANY($1::integer[])
           AND user_id = $2`,
        [hostIds, userId]
    );

    return result.rows.length === hostIds.length;
};
const fetchMetricQuery = async ({
    hostIds,
    from,
    to,
    step,
    agg,
    source
}) => {
    const stepInterval = QUERY_STEPS[step];

    const timestampColumn = source.type === 'raw'
        ? 'COALESCE(collected_at, timestamp)'
        : 'bucket_start';

    const metricExpressions = METRICS.map((metric) => {
        const expression = source.type === 'raw'
            ? getRawAggregate(metric, agg)
            : getRollupAggregate(metric, agg);

        return `${expression} AS ${metric}`;
    });

    const result = await pool.query(
        `SELECT
            host_id,
            date_bin(
                $4::interval,
                ${timestampColumn},
                TIMESTAMPTZ '2000-01-01 00:00:00+00'
            ) AS timestamp,
            ${metricExpressions.join(',\n            ')}
         FROM ${source.table}
         WHERE host_id = ANY($1::integer[])
           AND ${timestampColumn} >= $2
           AND ${timestampColumn} < $3
         GROUP BY
            host_id,
            date_bin(
                $4::interval,
                ${timestampColumn},
                TIMESTAMPTZ '2000-01-01 00:00:00+00'
            )
         ORDER BY host_id ASC, timestamp ASC`,
        [hostIds, from, to, stepInterval]
    );

    return result.rows;
};

module.exports = {
    QUERY_STEPS,
    getQuerySource,
    isStepCompatible,
    verifyHostsOwnership,
    fetchMetricQuery
};
