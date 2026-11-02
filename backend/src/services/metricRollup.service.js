const pool = require('../config/db');

// Aggregates `metric_rollups_5m` rows from the last 7 days into 1-hour
// buckets. Uses ON CONFLICT to upsert, so it's safe to re-run every 5
// minutes â€” the current (partial) bucket gets refined until it's complete,
// and re-processing already-complete buckets is a no-op.
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
            NOW() - INTERVAL '3 days',
            LEAST(
                NOW() - INTERVAL '2 hours',
                COALESCE(
                    lr.latest_bucket - INTERVAL '5 minutes',
                    NOW() - INTERVAL '3 days'
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
    `);
}

// Aggregates `metric_rollups_5m` rows from the last 3 hours into 1-hour
// buckets. Averages are sample-count-weighted so a partially-filled 5m
// bucket doesn't skew the hourly average.
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
        WHERE bucket_start >= NOW() - INTERVAL '7 days'
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
// The data isn't lost â€” it already lives on in the 5m/1h rollups.
async function cleanupRawMetrics() {
    const result = await pool.query(
        `DELETE FROM metrics WHERE COALESCE(collected_at, timestamp) < NOW() - INTERVAL '3 days'`
    );
    return result.rowCount;
}


async function cleanupHistoricalData() {
    const cleanupQueries = [
        {
            name: '5-minute rollups',
            sql: `DELETE FROM metric_rollups_5m
                  WHERE bucket_start < NOW() - INTERVAL '8 days'`
        },
        {
            name: 'hourly rollups',
            sql: `DELETE FROM metric_rollups_1h
                  WHERE bucket_start < NOW() - INTERVAL '90 days'`
        },
        {
            name: 'anomalies',
            sql: `DELETE FROM anomalies
                  WHERE timestamp < NOW() - INTERVAL '30 days'`
        },
        {
            name: 'traces',
            sql: `DELETE FROM traces
                  WHERE timestamp < NOW() - INTERVAL '7 days'`
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
    cleanupHistoricalData
};
