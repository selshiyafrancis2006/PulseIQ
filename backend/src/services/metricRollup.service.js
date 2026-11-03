const pool = require('../config/db');

function intFromEnv(name, fallback, min) {
    const value = Number.parseInt(process.env[name], 10);
    return Number.isInteger(value) && value >= min ? value : fallback;
}

// Retention windows (days). A value below its minimum is ignored and the
// default is used, because each window must outlive what reads from it:
//   raw      - feeds the 5-minute rollup
//   5m       - read by the 6h/24h ranges and by rollup1Hour (7-day window)
//   1h       - read by the 3d-90d ranges
// The values are validated integers, so they are safe to put in the SQL.
const RAW_RETENTION_DAYS = intFromEnv('METRICS_RAW_RETENTION_DAYS', 3, 1);
const ROLLUP_5M_RETENTION_DAYS = intFromEnv('METRICS_ROLLUP_5M_RETENTION_DAYS', 8, 8);
const ROLLUP_1H_RETENTION_DAYS = intFromEnv('METRICS_ROLLUP_1H_RETENTION_DAYS', 90, 90);
const ANOMALY_RETENTION_DAYS = intFromEnv('ANOMALY_RETENTION_DAYS', 30, 1);
const TRACE_RETENTION_DAYS = intFromEnv('TRACE_RETENTION_DAYS', 7, 1);

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
async function rollup5Minute() {
    await pool.query(`
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
            SELECT
                host_id,
                MAX(bucket_start) AS latest_bucket
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
        WHERE COALESCE(m.collected_at, m.timestamp) >= GREATEST(
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
    `);
}

// Aggregates `metric_rollups_5m` rows from the last 7 days into 1-hour
// buckets. The window starts on a whole hour, so the oldest hour is always
// aggregated from all twelve of its 5-minute buckets. Starting mid-hour would
// rebuild that hour from only some of them and overwrite its correct values.
// Averages are sample-count-weighted so a partially-filled 5m bucket doesn't
// skew the hourly average.
async function rollup1Hour() {
    await pool.query(`
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
        WHERE bucket_start >= date_trunc('hour', NOW() - INTERVAL '7 days', 'UTC')
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
    `);
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

module.exports = {
    rollup5Minute,
    rollup1Hour,
    cleanupRawMetrics,
    cleanupHistoricalData,
    RAW_RETENTION_DAYS,
    ROLLUP_5M_RETENTION_DAYS,
    ROLLUP_1H_RETENTION_DAYS,
    ANOMALY_RETENTION_DAYS,
    TRACE_RETENTION_DAYS
};