const db = require('../config/db');

function intFromEnv(name, fallback, min) {
    const value = Number.parseInt(process.env[name], 10);
    return Number.isInteger(value) && value >= min ? value : fallback;
}

// Raw rows must outlive the longest range the API reads from them (30d).
const RAW_RETENTION_DAYS = intFromEnv('MONITOR_RESULTS_RETENTION_DAYS', 35, 31);
const ROLLUP_RETENTION_DAYS = intFromEnv('MONITOR_ROLLUP_RETENTION_DAYS', 400, 31);

// whereSql is always a fixed string from this file, never user input.
async function runRollup(whereSql, params = []) {
    const result = await db.query(
        `INSERT INTO monitor_rollups_1h (
            monitor_id, bucket_start, total_checks, up_checks,
            maintenance_checks, avg_response_ms, min_response_ms,
            max_response_ms, p95_response_ms
        )
        SELECT
            mr.monitor_id,
            date_trunc('hour', mr.checked_at, 'UTC'),
            COUNT(*) FILTER (WHERE NOT mr.in_maintenance)::int,
            COUNT(*) FILTER (
                WHERE NOT mr.in_maintenance AND mr.status = 'UP'
            )::int,
            COUNT(*) FILTER (WHERE mr.in_maintenance)::int,
            AVG(mr.response_time_ms) FILTER (WHERE NOT mr.in_maintenance),
            MIN(mr.response_time_ms) FILTER (WHERE NOT mr.in_maintenance),
            MAX(mr.response_time_ms) FILTER (WHERE NOT mr.in_maintenance),
            percentile_cont(0.95) WITHIN GROUP (
                ORDER BY mr.response_time_ms::float8
            ) FILTER (
                WHERE NOT mr.in_maintenance
                  AND mr.response_time_ms IS NOT NULL
            )
        FROM monitor_results mr
        WHERE ${whereSql}
        GROUP BY mr.monitor_id, date_trunc('hour', mr.checked_at, 'UTC')
        ON CONFLICT (monitor_id, bucket_start) DO UPDATE SET
            total_checks = EXCLUDED.total_checks,
            up_checks = EXCLUDED.up_checks,
            maintenance_checks = EXCLUDED.maintenance_checks,
            avg_response_ms = EXCLUDED.avg_response_ms,
            min_response_ms = EXCLUDED.min_response_ms,
            max_response_ms = EXCLUDED.max_response_ms,
            p95_response_ms = EXCLUDED.p95_response_ms`,
        params
    );

    return result.rowCount;
}

// Re-aggregates the last N hours from raw rows. Safe to re-run: the window
// starts on an hour boundary, so every bucket is rebuilt in full.
async function rollupRecentMonitorResults(hours = 3) {
    return runRollup(
        `mr.checked_at >= date_trunc(
            'hour',
            (NOW()) - $1::int * INTERVAL '1 hour'
         )`,
        [hours]
    );
}

// One-off backfill of everything currently in monitor_results.
async function rollupAllMonitorResults() {
    return runRollup('TRUE');
}

// 1) roll up everything about to be deleted, 2) delete it, 3) trim old rollups.
// The cutoff is aligned to a whole hour so a bucket is never half-deleted.
async function cleanupMonitorResults() {
    const cutoff = `date_trunc(
        'hour',
        (NOW()) - $1::int * INTERVAL '1 day'
    )`;

    const rolledUp = await runRollup(
        `mr.checked_at < ${cutoff}`,
        [RAW_RETENTION_DAYS]
    );

    const rawDeleted = await db.query(
        `DELETE FROM monitor_results WHERE checked_at < ${cutoff}`,
        [RAW_RETENTION_DAYS]
    );

    const rollupsDeleted = await db.query(
        `DELETE FROM monitor_rollups_1h
         WHERE bucket_start < NOW() - $1::int * INTERVAL '1 day'`,
        [ROLLUP_RETENTION_DAYS]
    );

    return {
        rolledUpBuckets: rolledUp,
        rawDeleted: rawDeleted.rowCount,
        rollupsDeleted: rollupsDeleted.rowCount
    };
}

module.exports = {
    rollupRecentMonitorResults,
    rollupAllMonitorResults,
    cleanupMonitorResults,
    RAW_RETENTION_DAYS,
    ROLLUP_RETENTION_DAYS
};