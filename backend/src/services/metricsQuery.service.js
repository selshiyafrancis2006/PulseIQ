const pool = require('../config/db');
const {
    RAW_RETENTION_DAYS,
    ROLLUP_5M_RETENTION_DAYS
} = require('./metricRollup.service');

const DAY_MS = 24 * 60 * 60 * 1000;
const FIVE_MINUTES_MS = 5 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

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
    '5m': FIVE_MINUTES_MS,
    '15m': 15 * 60 * 1000,
    '1h': HOUR_MS,
    '6h': 6 * HOUR_MS,
    '1d': DAY_MS
};

const METRICS = [
    'cpu_usage',
    'memory_usage',
    'disk_usage',
    'network_in',
    'network_out'
];

const isStepCompatible = (step, source) => {
    return (
        Object.prototype.hasOwnProperty.call(QUERY_STEP_MS, step) &&
        QUERY_STEP_MS[step] >= source.resolutionMs
    );
};

const getQuerySource = (from, now = Date.now()) => {
    const age = now - from.getTime();

    if (age <= RAW_RETENTION_DAYS * DAY_MS) {
        return {
            table: 'metrics',
            resolutionMs: 60 * 1000,
            type: 'raw'
        };
    }

    if (age <= ROLLUP_5M_RETENTION_DAYS * DAY_MS) {
        return {
            table: 'metric_rollups_5m',
            resolutionMs: FIVE_MINUTES_MS,
            type: '5m'
        };
    }

    return {
        table: 'metric_rollups_1h',
        resolutionMs: HOUR_MS,
        type: '1h'
    };
};

// Splits a query into non-overlapping source ranges.
//
// The cutovers are rounded UP to the next source bucket boundary.
// This ensures that an older rollup source owns the complete bucket
// containing the retention boundary, while the newer source starts
// at the following bucket.
const getQuerySources = (from, to, now = Date.now()) => {
    const rawCutover = Math.ceil(
        (now - RAW_RETENTION_DAYS * DAY_MS) / FIVE_MINUTES_MS
    ) * FIVE_MINUTES_MS;

    const rollup5mCutover = Math.ceil(
        (now - ROLLUP_5M_RETENTION_DAYS * DAY_MS) / HOUR_MS
    ) * HOUR_MS;

    const boundaries = [
        {
            start: from.getTime(),
            end: Math.min(to.getTime(), rollup5mCutover),
            source: {
                table: 'metric_rollups_1h',
                resolutionMs: HOUR_MS,
                type: '1h'
            }
        },
        {
            start: Math.max(from.getTime(), rollup5mCutover),
            end: Math.min(to.getTime(), rawCutover),
            source: {
                table: 'metric_rollups_5m',
                resolutionMs: FIVE_MINUTES_MS,
                type: '5m'
            }
        },
        {
            start: Math.max(from.getTime(), rawCutover),
            end: to.getTime(),
            source: {
                table: 'metrics',
                resolutionMs: 60 * 1000,
                type: 'raw'
            }
        }
    ];

    return boundaries
        .filter((segment) => segment.start < segment.end)
        .map((segment) => ({
            source: segment.source,
            from: new Date(segment.start),
            to: new Date(segment.end)
        }));
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

const getMetricExpression = (metric, sourceType) => {
    if (sourceType === 'raw') {
        return `
            ${metric} AS ${metric}_avg,
            ${metric} AS ${metric}_min,
            ${metric} AS ${metric}_max
        `;
    }

    return `
        ${metric}_avg,
        ${metric}_min,
        ${metric}_max
    `;
};

const buildSourceQuery = (source, startParam, endParam) => {
    const timestampColumn = source.type === 'raw'
        ? 'COALESCE(collected_at, timestamp)'
        : 'bucket_start';

    const metricExpressions = METRICS.map((metric) =>
        getMetricExpression(metric, source.type)
    );

    const sampleCountExpression = source.type === 'raw'
        ? '1::bigint AS sample_count'
        : 'sample_count::bigint AS sample_count';

    return {
        sql: `
            SELECT
                host_id,
                ${timestampColumn} AS source_timestamp,
                ${metricExpressions.join(',\n                ')},
                ${sampleCountExpression}
            FROM ${source.table}
            WHERE host_id = ANY($1::integer[])
              AND ${timestampColumn} >= $${startParam}
              AND ${timestampColumn} < $${endParam}
        `,
        timestampColumn
    };
};
const getAggregateExpression = (metric, agg) => {
    if (agg === 'avg') {
        return `
            SUM(${metric}_avg * sample_count)::double precision
            / NULLIF(
                SUM(sample_count) FILTER (
                    WHERE ${metric}_avg IS NOT NULL
                ),
                0
            )
        `;
    }

    if (agg === 'min') {
        return `MIN(${metric}_min)`;
    }

    if (agg === 'max') {
        return `MAX(${metric}_max)`;
    }

    return `percentile_cont(0.95) WITHIN GROUP (ORDER BY ${metric}_avg)`;
};

const fetchMetricQuery = async ({
    hostIds,
    from,
    to,
    step,
    agg,
    sources
}) => {
    if (!Array.isArray(sources) || sources.length === 0) {
        return [];
    }

    const values = [hostIds];
    const sourceQueries = [];

    for (const segment of sources) {
        const startParam = values.length + 1;
        values.push(segment.from);

        const endParam = values.length + 1;
        values.push(segment.to);

        const query = buildSourceQuery(
            segment.source,
            startParam,
            endParam
        );

        sourceQueries.push(query.sql);
    }

    const stepParam = values.length + 1;
    values.push(QUERY_STEPS[step]);

    const aggregateExpressions = METRICS.map((metric) =>
        `${getAggregateExpression(metric, agg)} AS ${metric}`
    );

    const result = await pool.query(
        `
        WITH combined AS (
            ${sourceQueries.join('\nUNION ALL\n')}
        )
        SELECT
            host_id,
            date_bin(
                $${stepParam}::interval,
                source_timestamp,
                TIMESTAMPTZ '2000-01-01 00:00:00+00'
            ) AS timestamp,
            ${aggregateExpressions.join(',\n            ')}
        FROM combined
        GROUP BY
            host_id,
            date_bin(
                $${stepParam}::interval,
                source_timestamp,
                TIMESTAMPTZ '2000-01-01 00:00:00+00'
            )
        ORDER BY host_id ASC, timestamp ASC
        `,
        values
    );

    return result.rows;
};

module.exports = {
    QUERY_STEPS,
    getQuerySource,
    getQuerySources,
    isStepCompatible,
    verifyHostsOwnership,
    fetchMetricQuery
};