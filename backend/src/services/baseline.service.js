const pool = require('../config/db');

const METRIC_NAMES = [
    'cpu_usage',
    'memory_usage',
    'disk_usage',
    'network_in',
    'network_out'
];

const MIN_SAMPLE_COUNT = 12;

const recomputeBaselines = async () => {

    const hostsResult = await pool.query('SELECT id FROM hosts');

    for (const host of hostsResult.rows) {

        for (const metricName of METRIC_NAMES) {

            const avgColumn = `${metricName}_avg`;

            const result = await pool.query(
                `SELECT
                    AVG(${avgColumn}) AS mean,
                    STDDEV(${avgColumn}) AS stddev,
                    COUNT(*) AS sample_count
                 FROM metric_rollups_1h
                 WHERE host_id = $1
                   AND bucket_start >= NOW() - INTERVAL '7 days'
                   AND ${avgColumn} IS NOT NULL`,
                [host.id]
            );

            const row = result.rows[0];
            const sampleCount = parseInt(row.sample_count, 10);

            if (sampleCount < MIN_SAMPLE_COUNT) {
                continue;
            }

            await pool.query(
                `INSERT INTO metric_baselines (host_id, metric_name, mean, stddev, sample_count, updated_at)
                 VALUES ($1, $2, $3, $4, $5, NOW())
                 ON CONFLICT (host_id, metric_name)
                 DO UPDATE SET
                    mean = EXCLUDED.mean,
                    stddev = EXCLUDED.stddev,
                    sample_count = EXCLUDED.sample_count,
                    updated_at = NOW()`,
                [host.id, metricName, row.mean, row.stddev || 0, sampleCount]
            );

        }

    }

};

const detectAnomalies = async (metric) => {

    if (!metric.host_id) {
        return;
    }

    const baselinesResult = await pool.query(
        'SELECT metric_name, mean, stddev FROM metric_baselines WHERE host_id = $1',
        [metric.host_id]
    );

    if (baselinesResult.rows.length === 0) {
        return;
    }

    const Z_SCORE_THRESHOLD = 3;

    for (const baseline of baselinesResult.rows) {

        const value = metric[baseline.metric_name];

        if (value === undefined || value === null) {
            continue;
        }

        if (baseline.stddev < 0.01) {
            continue;
        }

        const zScore = (value - baseline.mean) / baseline.stddev;

        if (Math.abs(zScore) > Z_SCORE_THRESHOLD) {

            await pool.query(
                `INSERT INTO anomalies (host_id, metric_name, value, baseline_mean, baseline_stddev, deviation_score)
                 VALUES ($1, $2, $3, $4, $5, $6)`,
                [metric.host_id, baseline.metric_name, value, baseline.mean, baseline.stddev, zScore]
            );

        }

    }

};

module.exports = {
    recomputeBaselines,
    detectAnomalies
};