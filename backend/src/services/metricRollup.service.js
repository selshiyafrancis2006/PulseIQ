const pool = require('../config/db');

// Aggregates raw `metrics` rows from the last 15 minutes into 5-minute
// buckets. Uses ON CONFLICT to upsert, so it's safe to re-run every 5
// minutes — the current (partial) bucket gets refined until it's complete,
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
        SELECT
            host_id,
            to_timestamp(floor(extract(epoch FROM timestamp) / 300) * 300) AS bucket_start,
            AVG(cpu_usage), MIN(cpu_usage), MAX(cpu_usage),
            AVG(memory_usage), MIN(memory_usage), MAX(memory_usage),
            AVG(disk_usage), MIN(disk_usage), MAX(disk_usage),
            AVG(network_in), MIN(network_in), MAX(network_in),
            AVG(network_out), MIN(network_out), MAX(network_out),
            COUNT(*)
        FROM metrics
        WHERE timestamp >= NOW() - INTERVAL '15 minutes'
        GROUP BY host_id, bucket_start
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
            date_trunc('hour', bucket_start) AS bucket_start,
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
        WHERE bucket_start >= NOW() - INTERVAL '3 hours'
        GROUP BY host_id, date_trunc('hour', bucket_start)
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
// The data isn't lost — it already lives on in the 5m/1h rollups.
async function cleanupRawMetrics() {
    const result = await pool.query(
        `DELETE FROM metrics WHERE timestamp < NOW() - INTERVAL '3 days'`
    );
    return result.rowCount;
}

module.exports = {
    rollup5Minute,
    rollup1Hour,
    cleanupRawMetrics
};