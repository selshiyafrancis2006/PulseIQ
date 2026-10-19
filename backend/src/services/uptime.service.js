
const db = require('../config/db');
const { checkHttp } = require('./httpCheck.service');
const { classifyCheckError } = require('./checkError.service');

async function saveCheckResult(monitor, result) {
    const previous = await db.query(
        `SELECT status
         FROM monitor_results
         WHERE monitor_id = $1
         ORDER BY checked_at DESC
         LIMIT 1`,
        [monitor.id]
    );

    const previousStatus = previous.rows[0]?.status;

    await db.query(
        `INSERT INTO monitor_results
         (monitor_id, status, response_time_ms, status_code,
          error_type, error_message,
          dns_time_ms, connect_time_ms, tls_time_ms,
          ttfb_time_ms, download_time_ms)
         VALUES (
            $1, $2, $3, $4, $5, $6,
            $7, $8, $9, $10, $11
         )`,
        [
            monitor.id,
            result.status,
            result.responseTime,
            result.statusCode,
            result.errorType,
            result.errorMessage,
            result.dnsTimeMs,
            result.connectTimeMs,
            result.tlsTimeMs,
            result.ttfbTimeMs,
            result.downloadTimeMs
        ]
    );

    // Record events only when the monitor changes state.
    if (previousStatus !== result.status) {
        if (result.status === 'UP' && previousStatus === 'DOWN') {
            await db.query(
                `INSERT INTO monitor_events
                 (monitor_id, type, message, response_time_ms)
                 VALUES ($1, $2, $3, $4)`,
                [
                    monitor.id,
                    'UP',
                    'Service recovered',
                    result.responseTime
                ]
            );
        } else if (
            result.status === 'DOWN' &&
            previousStatus !== 'DOWN'
        ) {
            await db.query(
                `INSERT INTO monitor_events
                 (monitor_id, type, message)
                 VALUES ($1, $2, $3)`,
                [
                    monitor.id,
                    'DOWN',
                    'Service is down'
                ]
            );
        }
    }

    // Preserve the return shape used by the API route and scheduler.
    return {
        status: result.status,
        responseTime: result.responseTime,
        statusCode: result.statusCode
    };
}

async function checkMonitor(monitor) {
    let result;

    try {
        const checked = await checkHttp(monitor);
        const isUp =
            checked.statusCode >= 200 &&
            checked.statusCode < 400;

        result = {
            status: isUp ? 'UP' : 'DOWN',
            responseTime: checked.responseTimeMs,
            statusCode: checked.statusCode,
            dnsTimeMs: checked.dnsTimeMs,
            connectTimeMs: checked.connectTimeMs,
            tlsTimeMs: checked.tlsTimeMs,
            ttfbTimeMs: checked.ttfbTimeMs,
            downloadTimeMs: checked.downloadTimeMs,
            errorType: isUp ? null : 'BAD_STATUS',
            errorMessage: isUp
                ? null
                : `Monitor returned HTTP ${checked.statusCode}`
        };
    } catch (error) {
        const classified = classifyCheckError(error);

        result = {
            status: 'DOWN',
            responseTime: null,
            statusCode: null,
            errorType: classified.errorType,
            errorMessage: classified.errorMessage
        };
    }

    // Keep database operations outside the HTTP-check catch.
    // Database errors must propagate to the caller.
    return saveCheckResult(monitor, result);
}

module.exports = { checkMonitor };
