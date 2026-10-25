const db = require('../config/db');
const { checkHttp } = require('./httpCheck.service');
const { classifyCheckError } = require('./checkError.service');
const { processCheckOutcome } = require('./monitorAlert.service');

async function saveCheckResult(monitor, result) {
    // Compare against the last result taken OUTSIDE maintenance, so a
    // window never creates or hides a state change.
    const previous = await db.query(
        `SELECT status
         FROM monitor_results
         WHERE monitor_id = $1
           AND NOT in_maintenance
         ORDER BY checked_at DESC
         LIMIT 1`,
        [monitor.id]
    );

    const previousStatus = previous.rows[0]?.status;

    // in_maintenance is decided in SQL with the database clock, using the
    // same rule the maintenance API uses to report a window as "active".
    const inserted = await db.query(
        `INSERT INTO monitor_results
         (monitor_id, status, response_time_ms, status_code,
          error_type, error_message,
          dns_time_ms, connect_time_ms, tls_time_ms,
          ttfb_time_ms, download_time_ms, in_maintenance)
         VALUES (
            $1, $2, $3, $4, $5, $6,
            $7, $8, $9, $10, $11,
            EXISTS (
                SELECT 1
                FROM maintenance_windows w
                JOIN monitors m ON m.id = $1
                WHERE w.user_id = m.user_id
                  AND (w.monitor_id IS NULL OR w.monitor_id = m.id)
                  AND NOW() >= w.starts_at
                  AND NOW() < w.ends_at
            )
         )
         RETURNING in_maintenance`,
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

    const inMaintenance = inserted?.rows?.[0]?.in_maintenance === true;

    // During maintenance: no state-change events, no alerts, no reminders.
    if (!inMaintenance) {
        let transition = null;

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
                transition = 'UP';
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
                transition = 'DOWN';
            }
        }

        // Notification logic must never invalidate a check that is
        // already saved.
        try {
            await processCheckOutcome(monitor, result, transition);
        } catch (error) {
            console.error(
                `Alert processing failed (monitor_id: ${monitor.id}):`,
                error
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