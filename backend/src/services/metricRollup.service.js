const pool = require('../config/db');

function intFromEnv(name, fallback, min) {
    const value = Number.parseInt(process.env[name], 10);
    return Number.isInteger(value) && value >= min ? value : fallback;
}

// Retention windows (days). Each tier supports its downstream consumers:
//   raw - newest query data and input to the 5-minute rollup;
//   5m  - query data between the raw and 5m retention cutovers, plus the
//         7-day input window used by rollup1Hour;
//   1h  - query data between the 5m and hourly retention cutovers.
// Minimums preserve the full rollup and query windows. Values are validated
// integers before being interpolated into SQL.
const RAW_RETENTION_DAYS = intFromEnv('METRICS_RAW_RETENTION_DAYS', 3, 1);
const ROLLUP_5M_RETENTION_DAYS = intFromEnv('METRICS_ROLLUP_5M_RETENTION_DAYS', 8, 8);
const ROLLUP_1H_RETENTION_DAYS = intFromEnv('METRICS_ROLLUP_1H_RETENTION_DAYS', 90, 90);
const ANOMALY_RETENTION_DAYS = intFromEnv('ANOMALY_RETENTION_DAYS', 30, 1);
const ANOMALY_BUCKET_RETENTION_DAYS = intFromEnv('ANOMALY_BUCKET_RETENTION_DAYS', 8, 8);
const TRACE_RETENTION_DAYS = intFromEnv('TRACE_RETENTION_DAYS', 7, 1);

function validateRollupRange(range, bucketSeconds, retentionDays, label) {
    if (!range || typeof range !== 'object') {
        throw new TypeError(`${label} backfill requires a from/to range`);
    }

    const from = new Date(range.from);
    const to = new Date(range.to);

    if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime())) {
        throw new TypeError(`${label} backfill range must contain valid dates`);
    }

    const bucketMs = bucketSeconds * 1000;

    if (from.getTime() % bucketMs !== 0 || to.getTime() % bucketMs !== 0) {
        throw new RangeError(`${label} backfill boundaries must align to UTC bucket boundaries`);
    }

    if (from >= to) {
        throw new RangeError(`${label} backfill from must be earlier than to`);
    }

    const now = Date.now();
    const retentionCutoff = now - retentionDays * 24 * 60 * 60 * 1000;
    const earliestSafeBucket = Math.ceil(retentionCutoff / bucketMs) * bucketMs;
    const latestCompleteBucket = Math.floor(now / bucketMs) * bucketMs;

    if (from.getTime() < earliestSafeBucket) {
        throw new RangeError(`${label} backfill starts before the safely retained data window`);
    }

    if (to.getTime() > latestCompleteBucket) {
        throw new RangeError(`${label} backfill cannot include an incomplete current bucket`);
    }

    return {
        from: from.toISOString(),
        to: to.toISOString()
    };
}
// Aggregates raw `metrics` rows into 5-minute buckets, using the agent's
// collection time (collected_at) when present and the server time otherwise.
//
// Which raw rows are re-read on each run (per host):
//   - at least the last 2 hours, so the current bucket keeps being refined;
//   - further back, to the last bucket already rolled up, so buckets missed
//     while the job was down or failing get filled in;
//   - never further back than the raw retention window.
// Both ends are aligned to bucket boundaries. The start is rounded DOWN, so
// the oldest bucket is read in full instead of being rebuilt from part of its
// rows. The retention cap is rounded UP, so a bucket whose older raw rows may
// already be deleted is never rebuilt from what is left of it.
// Uses ON CONFLICT to upsert, so re-running is safe and idempotent.
async function rollup5Minute(client = pool, requestedRange = null) {
    const range = requestedRange
        ? validateRollupRange(requestedRange, 300, RAW_RETENTION_DAYS, '5-minute')
        : null;

    await client.query(`
        INSERT INTO metric_rollups_5m (
            host_id, bucket_start,
            cpu_usage_avg, cpu_usage_min, cpu_usage_max,
            memory_usage_avg, memory_usage_min, memory_usage_max,
            disk_usage_avg, disk_usage_min, disk_usage_max,
            network_in_avg, network_in_min, network_in_max,
            network_out_avg, network_out_min, network_out_max,
            sample_count
        )
        WITH latest_rollups AS MATERIALIZED (
            SELECT host_id, MAX(bucket_start) AS latest_bucket
            FROM metric_rollups_5m
            GROUP BY host_id
        )
        SELECT
            m.host_id,
            to_timestamp(floor(extract(epoch FROM COALESCE(m.collected_at, m.timestamp)) / 300) * 300) AS bucket_start,
            AVG(m.cpu_usage), MIN(m.cpu_usage), MAX(m.cpu_usage),
            AVG(m.memory_usage), MIN(m.memory_usage), MAX(m.memory_usage),
            AVG(m.disk_usage), MIN(m.disk_usage), MAX(m.disk_usage),
            AVG(m.network_in), MIN(m.network_in), MAX(m.network_in),
            AVG(m.network_out), MIN(m.network_out), MAX(m.network_out),
            COUNT(*)
        FROM metrics m
        LEFT JOIN latest_rollups lr ON lr.host_id = m.host_id
        WHERE (
            $1::timestamptz IS NOT NULL
            AND COALESCE(m.collected_at, m.timestamp) >= $1::timestamptz
            AND COALESCE(m.collected_at, m.timestamp) < $2::timestamptz
        ) OR (
            $1::timestamptz IS NULL
            AND COALESCE(m.collected_at, m.timestamp) >= GREATEST(
                to_timestamp(
                    ceil(extract(epoch FROM NOW() - INTERVAL '${RAW_RETENTION_DAYS} days') / 300) * 300
                ),
                to_timestamp(
                    floor(
                        extract(epoch FROM LEAST(
                            NOW() - INTERVAL '2 hours',
                            COALESCE(
                                lr.latest_bucket - INTERVAL '5 minutes',
                                NOW() - INTERVAL '${RAW_RETENTION_DAYS} days'
                            )
                        )) / 300
                    ) * 300
                )
            )
        )
        GROUP BY m.host_id, bucket_start
        ON CONFLICT (host_id, bucket_start) DO UPDATE SET
            cpu_usage_avg = EXCLUDED.cpu_usage_avg,
            cpu_usage_min = EXCLUDED.cpu_usage_min,
            cpu_usage_max = EXCLUDED.cpu_usage_max,
            memory_usage_avg = EXCLUDED.memory_usage_avg,
            memory_usage_min = EXCLUDED.memory_usage_min,
            memory_usage_max = EXCLUDED.memory_usage_max,
            disk_usage_avg = EXCLUDED.disk_usage_avg,
            disk_usage_min = EXCLUDED.disk_usage_min,
            disk_usage_max = EXCLUDED.disk_usage_max,
            network_in_avg = EXCLUDED.network_in_avg,
            network_in_min = EXCLUDED.network_in_min,
            network_in_max = EXCLUDED.network_in_max,
            network_out_avg = EXCLUDED.network_out_avg,
            network_out_min = EXCLUDED.network_out_min,
            network_out_max = EXCLUDED.network_out_max,
            sample_count = EXCLUDED.sample_count
    `, [range?.from ?? null, range?.to ?? null]);
}

// Aggregates `metric_rollups_5m` rows from the last 7 days into 1-hour
// buckets. The window starts on a whole hour, so the oldest hour is always
// aggregated from all twelve of its 5-minute buckets. Starting mid-hour would
// rebuild that hour from only some of them and overwrite its correct values.
// Averages are sample-count-weighted so a partially-filled 5m bucket doesn't
// skew the hourly average.
async function rollup1Hour(client = pool, requestedRange = null) {
    const range = requestedRange
        ? validateRollupRange(requestedRange, 3600, ROLLUP_5M_RETENTION_DAYS, 'hourly')
        : null;

    await client.query(`
        INSERT INTO metric_rollups_1h (
            host_id, bucket_start,
            cpu_usage_avg, cpu_usage_min, cpu_usage_max,
            memory_usage_avg, memory_usage_min, memory_usage_max,
            disk_usage_avg, disk_usage_min, disk_usage_max,
            network_in_avg, network_in_min, network_in_max,
            network_out_avg, network_out_min, network_out_max,
            sample_count
        )
        SELECT
            host_id,
            date_trunc('hour', bucket_start, 'UTC') AS bucket_start,
            SUM(cpu_usage_avg * sample_count) / NULLIF(SUM(sample_count), 0),
            MIN(cpu_usage_min), MAX(cpu_usage_max),
            SUM(memory_usage_avg * sample_count) / NULLIF(SUM(sample_count), 0),
            MIN(memory_usage_min), MAX(memory_usage_max),
            SUM(disk_usage_avg * sample_count) / NULLIF(SUM(sample_count), 0),
            MIN(disk_usage_min), MAX(disk_usage_max),
            SUM(network_in_avg * sample_count) / NULLIF(SUM(sample_count), 0),
            MIN(network_in_min), MAX(network_in_max),
            SUM(network_out_avg * sample_count) / NULLIF(SUM(sample_count), 0),
            MIN(network_out_min), MAX(network_out_max),
            SUM(sample_count)
        FROM metric_rollups_5m
        WHERE (
            $1::timestamptz IS NOT NULL
            AND bucket_start >= $1::timestamptz
            AND bucket_start < $2::timestamptz
        ) OR (
            $1::timestamptz IS NULL
            AND bucket_start >= date_trunc('hour', NOW() - INTERVAL '7 days', 'UTC')
            AND bucket_start < date_trunc('hour', NOW(), 'UTC')
        )
        GROUP BY host_id, date_trunc('hour', bucket_start, 'UTC')
        ON CONFLICT (host_id, bucket_start) DO UPDATE SET
            cpu_usage_avg = EXCLUDED.cpu_usage_avg,
            cpu_usage_min = EXCLUDED.cpu_usage_min,
            cpu_usage_max = EXCLUDED.cpu_usage_max,
            memory_usage_avg = EXCLUDED.memory_usage_avg,
            memory_usage_min = EXCLUDED.memory_usage_min,
            memory_usage_max = EXCLUDED.memory_usage_max,
            disk_usage_avg = EXCLUDED.disk_usage_avg,
            disk_usage_min = EXCLUDED.disk_usage_min,
            disk_usage_max = EXCLUDED.disk_usage_max,
            network_in_avg = EXCLUDED.network_in_avg,
            network_in_min = EXCLUDED.network_in_min,
            network_in_max = EXCLUDED.network_in_max,
            network_out_avg = EXCLUDED.network_out_avg,
            network_out_min = EXCLUDED.network_out_min,
            network_out_max = EXCLUDED.network_out_max,
            sample_count = EXCLUDED.sample_count
    `, [range?.from ?? null, range?.to ?? null]);
}

// Deletes raw high-resolution metric rows older than the retention window.
// The data isn't lost - it already lives on in the 5m/1h rollups.
async function cleanupRawMetrics() {
    const result = await pool.query(
        `DELETE FROM metrics
         WHERE COALESCE(collected_at, timestamp) < NOW() - INTERVAL '${RAW_RETENTION_DAYS} days'`
    );
    return result.rowCount;
}

async function cleanupHistoricalData() {
    const cleanupQueries = [
        {
            name: '5-minute rollups',
            sql: `DELETE FROM metric_rollups_5m
                  WHERE bucket_start < NOW() - INTERVAL '${ROLLUP_5M_RETENTION_DAYS} days'`
        },
        {
            name: 'hourly rollups',
            sql: `DELETE FROM metric_rollups_1h
                  WHERE bucket_start < NOW() - INTERVAL '${ROLLUP_1H_RETENTION_DAYS} days'`
        },
        {
            name: 'anomalies',
            sql: `DELETE FROM anomalies
                  WHERE timestamp < NOW() - INTERVAL '${ANOMALY_RETENTION_DAYS} days'`
        },
        {
            name: 'anomaly detection buckets',
            sql: `DELETE FROM anomaly_detection_buckets
                  WHERE processed_at < NOW() - INTERVAL '${ANOMALY_BUCKET_RETENTION_DAYS} days'`
        },
        {
            name: 'traces',
            sql: `DELETE FROM traces
                  WHERE timestamp < NOW() - INTERVAL '${TRACE_RETENTION_DAYS} days'`
        }
    ];

    const deletedCounts = {};

    for (const query of cleanupQueries) {
        const result = await pool.query(query.sql);
        deletedCounts[query.name] = result.rowCount;
    }

    return deletedCounts;
}

async function withMetricRollupLock(callback) {
    if (typeof callback !== 'function') {
        throw new TypeError('Metric rollup lock requires a callback');
    }

    const client = await pool.connect();

    try {
        await client.query('BEGIN');
        await client.query('SELECT pg_advisory_xact_lock(7002, 1)');

        const result = await callback(client);

        await client.query('COMMIT');
        return result;
    } catch (err) {
        try {
            await client.query('ROLLBACK');
        } catch (rollbackError) {
            console.error('Metric rollup transaction rollback failed:', rollbackError);
        }

        throw err;
    } finally {
        client.release();
    }
}
module.exports = {
    withMetricRollupLock,
    rollup5Minute,
    rollup1Hour,
    cleanupRawMetrics,
    cleanupCustomMetrics,
    cleanupHistoricalData,
    RAW_RETENTION_DAYS,
    ROLLUP_5M_RETENTION_DAYS,
    ROLLUP_1H_RETENTION_DAYS,
    ANOMALY_RETENTION_DAYS,
    ANOMALY_BUCKET_RETENTION_DAYS,
    TRACE_RETENTION_DAYS
};

async function cleanupCustomMetrics() {
    const result = await pool.query(
        `DELETE FROM custom_metrics
         WHERE collected_at < NOW() - INTERVAL '${RAW_RETENTION_DAYS} days'`
    );

    return result.rowCount;
}
