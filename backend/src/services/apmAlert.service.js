const pool = require('../config/db');
const { evaluateAlerts } = require('./alert.service');

// Rule metric names handled by this module. They are stored in the same
// alert_rules table as cpu_usage / memory_usage / disk_usage, so users manage
// them from the existing Alert Rules page.
const APM_ALERT_METRICS = ['apm_p95_ms', 'apm_error_rate'];

const DEFAULT_WINDOW_MINUTES = 5;
const DEFAULT_MIN_REQUESTS = 20;

function readPositiveInt(name, fallback) {
    const parsed = Number(process.env[name]);

    return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function getApmAlertConfig() {
    return {
        // How far back the p95 / error rate is computed.
        windowMinutes: readPositiveInt(
            'APM_ALERT_WINDOW_MINUTES',
            DEFAULT_WINDOW_MINUTES
        ),
        // Hosts with fewer requests than this in the window are skipped, so
        // 1 failure out of 2 requests does not read as a 50% error rate.
        minRequests: readPositiveInt(
            'APM_ALERT_MIN_REQUESTS',
            DEFAULT_MIN_REQUESTS
        )
    };
}

function round(value, digits) {
    const factor = 10 ** digits;

    return Math.round(value * factor) / factor;
}

// Turns one aggregated traces row into the metric object the existing alert
// engine (evaluateAlerts) expects: { host_id, <metric_name>: value }.
function buildApmMetric(row) {
    const requestCount = Number(row.request_count);
    const errorCount = Number(row.error_count);

    if (!Number.isFinite(requestCount) || requestCount <= 0) {
        return null;
    }

    const metric = {
        host_id: row.host_id,
        // 5xx only: 4xx are client mistakes, not a service failure.
        apm_error_rate: round((errorCount / requestCount) * 100, 2)
    };

    const p95 = Number(row.p95_ms);

    if (row.p95_ms !== null && row.p95_ms !== undefined && Number.isFinite(p95)) {
        metric.apm_p95_ms = round(p95, 1);
    }

    return metric;
}

// Only hosts whose owner has an active APM rule are aggregated.
async function fetchApmWindowStats({ windowMinutes }) {
    const result = await pool.query(
        `SELECT
            h.id AS host_id,
            COUNT(t.id)::int AS request_count,
            COUNT(t.id) FILTER (WHERE t.status_code >= 500)::int AS error_count,
            percentile_cont(0.95) WITHIN GROUP (ORDER BY t.duration_ms) AS p95_ms
         FROM hosts h
         LEFT JOIN traces t
           ON t.host_id = h.id
          AND t.timestamp >= NOW() - ($1::int * INTERVAL '1 minute')
         WHERE EXISTS (
             SELECT 1
             FROM alert_rules ar
             WHERE ar.user_id = h.user_id
               AND ar.is_active = true
               AND ar.metric_name = ANY($2::text[])
               AND (ar.host_id IS NULL OR ar.host_id = h.id)
         )
         GROUP BY h.id
         ORDER BY h.id`,
        [windowMinutes, APM_ALERT_METRICS]
    );

    return result.rows;
}

async function runApmAlertCheck() {
    const config = getApmAlertConfig();
    const rows = await fetchApmWindowStats(config);

    let evaluated = 0;
    let failed = 0;

    for (const row of rows) {
        const metric = buildApmMetric(row);

        if (!metric) {
            continue;
        }

        try {
            // Reuses the existing rule matching, consecutive-breach counting
            // (rule.duration), breach/recovery state and alert insertion.
            const recoveryOnly = Number(row.request_count) < config.minRequests;
            await evaluateAlerts(metric, { recoveryOnly });
            evaluated += 1;
        } catch (err) {
            failed += 1;
            console.error(
                `APM alert evaluation failed (host_id: ${row.host_id}):`,
                err
            );
        }
    }

    return { hosts: rows.length, evaluated, failed };
}

module.exports = {
    APM_ALERT_METRICS,
    getApmAlertConfig,
    buildApmMetric,
    fetchApmWindowStats,
    runApmAlertCheck
};
