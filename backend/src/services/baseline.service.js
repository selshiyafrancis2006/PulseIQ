const pool = require('../config/db');
const { METRIC_NAMES } = require('../config/metricRegistry');



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

const detectHourlyAnomalies = async (client) => {
    if (!client || typeof client.query !== 'function') {
        throw new TypeError('A PostgreSQL transaction client is required');
    }

    const candidatesResult = await client.query(`
        SELECT
            r.host_id,
            r.bucket_start,
            metric_values.metric_name,
            metric_values.value,
            b.mean AS baseline_mean,
            b.stddev AS baseline_stddev
        FROM metric_rollups_1h r
        CROSS JOIN LATERAL (VALUES
            ${METRIC_NAMES.map(metricName => `('${metricName}', r.${metricName}_avg)`).join(',\n            ')}
        ) AS metric_values(metric_name, value)
        INNER JOIN metric_baselines b
            ON b.host_id = r.host_id
           AND b.metric_name = metric_values.metric_name
        LEFT JOIN anomaly_detection_buckets processed
            ON processed.host_id = r.host_id
           AND processed.metric_name = metric_values.metric_name
           AND processed.bucket_start = r.bucket_start
        WHERE r.bucket_start >= NOW() - INTERVAL '7 days'
          AND r.bucket_start < date_trunc('hour', NOW())
          AND metric_values.value IS NOT NULL
          AND processed.host_id IS NULL
        ORDER BY r.bucket_start ASC, r.host_id ASC, metric_values.metric_name ASC
    `);

    const summary = { examined: 0, detected: 0, cooldownSuppressed: 0 };
    const Z_SCORE_THRESHOLD = 3;

    for (const candidate of candidatesResult.rows) {
        const value = Number(candidate.value);
        const mean = Number(candidate.baseline_mean);
        const stddev = Number(candidate.baseline_stddev);

        if (!Number.isFinite(value) || !Number.isFinite(mean) || !Number.isFinite(stddev)) {
            await client.query(
                `INSERT INTO anomaly_detection_buckets (host_id, metric_name, bucket_start)
                 VALUES ($1, $2, $3)
                 ON CONFLICT (host_id, metric_name, bucket_start) DO NOTHING`,
                [candidate.host_id, candidate.metric_name, candidate.bucket_start]
            );

            summary.examined += 1;
            continue;
        }

        const zScore = stddev >= 0.01 ? (value - mean) / stddev : 0;
        const isAnomalous = stddev >= 0.01 && Math.abs(zScore) > Z_SCORE_THRESHOLD;

        if (isAnomalous) {
            const cooldownResult = await client.query(
                `SELECT 1
                 FROM anomalies
                 WHERE host_id = $1
                   AND metric_name = $2
                   AND bucket_start > $3::timestamptz - INTERVAL '6 hours'
                   AND bucket_start < $3::timestamptz
                 LIMIT 1`,
                [candidate.host_id, candidate.metric_name, candidate.bucket_start]
            );

            if (cooldownResult.rows.length > 0) {
                summary.cooldownSuppressed += 1;
            } else {
                const anomalyInsertResult = await client.query(
                    `INSERT INTO anomalies
                        (host_id, metric_name, value, baseline_mean, baseline_stddev, deviation_score, bucket_start, timestamp)
                     VALUES ($1, $2, $3, $4, $5, $6, $7, $7)
                     ON CONFLICT (host_id, metric_name, bucket_start)
                         WHERE bucket_start IS NOT NULL
                     DO NOTHING`,
                    [
                        candidate.host_id,
                        candidate.metric_name,
                        value,
                        mean,
                        stddev,
                        zScore,
                        candidate.bucket_start
                    ]
                );
                if (anomalyInsertResult.rowCount > 0) {
                    summary.detected += 1;
                }
            }
        }

        await client.query(
            `INSERT INTO anomaly_detection_buckets (host_id, metric_name, bucket_start)
             VALUES ($1, $2, $3)
             ON CONFLICT (host_id, metric_name, bucket_start) DO NOTHING`,
            [candidate.host_id, candidate.metric_name, candidate.bucket_start]
        );

        summary.examined += 1;
    }

    return summary;
};
module.exports = {
    recomputeBaselines,
    detectHourlyAnomalies
};