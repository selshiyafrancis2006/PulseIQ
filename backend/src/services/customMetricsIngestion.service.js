const pool = require('../config/db');

async function saveCustomMetrics(hostId, sample) {
    if (!Number.isSafeInteger(hostId) || hostId < 1) {
        throw new TypeError('Invalid host ID');
    }

    const { sample_id, collected_at, metrics } = sample;

    const result = await pool.query(
        `INSERT INTO custom_metrics (
            host_id,
            sample_id,
            metric_name,
            value,
            unit,
            tags,
            collected_at
        )
        SELECT
            $1,
            $2,
            observation.metric_name,
            observation.value,
            observation.unit,
            COALESCE(observation.tags, '{}'::jsonb),
            $4
        FROM jsonb_to_recordset($3::jsonb) AS observation(
            metric_name TEXT,
            value DOUBLE PRECISION,
            unit TEXT,
            tags JSONB
        )
        ON CONFLICT (host_id, sample_id, metric_name, tags)
        DO NOTHING
        RETURNING id, metric_name, value, unit, tags, collected_at`,
        [
            hostId,
            sample_id,
            JSON.stringify(metrics),
            collected_at
        ]
    );

    if (result.rowCount > 0) {
        await pool.query(
            'UPDATE hosts SET last_seen_at = NOW() WHERE id = $1',
            [hostId]
        );
    }

    return {
        inserted: result.rowCount,
        duplicates: metrics.length - result.rowCount,
        observations: result.rows
    };
}

module.exports = { saveCustomMetrics };
