const db = require('../config/db');
const { checkHttp } = require('./httpCheck.service');
const { checkTcp } = require('./tcpCheck.service');
const { checkDns } = require('./dnsCheck.service');
const { classifyCheckError } = require('./checkError.service');
const { processCheckOutcome } = require('./monitorAlert.service');
const { processCertificateAlert } = require('./monitorCertificateAlert.service');


async function saveCheckResult(monitor, result) {
    // Keep raw check history independent of the confirmed monitor state.
    const previous = await db.query(
        `SELECT status
         FROM monitor_results
         WHERE monitor_id = $1
           AND NOT in_maintenance
         ORDER BY checked_at DESC, id DESC
         LIMIT 1`,
        [monitor.id]
    );

    const previousStatus = previous.rows[0]?.status;

    // Store every actual check, including checks during maintenance.
    const inserted = await db.query(
        `INSERT INTO monitor_results
         (monitor_id, status, response_time_ms, status_code,
          error_type, error_message,
          dns_time_ms, connect_time_ms, tls_time_ms,
          ttfb_time_ms, download_time_ms,
          certificate_expires_at, certificate_days_remaining,
          in_maintenance)
         VALUES (
            $1, $2, $3, $4, $5, $6,
            $7, $8, $9, $10, $11, $12, $13,
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
            result.dnsTimeMs ?? null,
            result.connectTimeMs ?? null,
            result.tlsTimeMs ?? null,
            result.ttfbTimeMs ?? null,
            result.downloadTimeMs ?? null,
            result.certificateExpiresAt ?? null,
            result.certificateDaysRemaining ?? null
        ]
    );

    const inMaintenance =
        inserted?.rows?.[0]?.in_maintenance === true;

    // Maintenance checks must not change the failure streak or alerts.
    if (inMaintenance) {
        return {
            status: result.status,
            responseTime: result.responseTime,
            statusCode: result.statusCode
        };
    }

    // Certificate alerts are independent of outage alerts.
    // The maintenance-window return above intentionally suppresses both.
    try {
        await processCertificateAlert(monitor, result);
    } catch (error) {
        console.error(
            `Certificate alert processing failed (monitor_id: ${monitor.id}):`,
            error
        );
    }
    // Read persistent state so the failure streak survives restarts.
    const stateResult = await db.query(
        `SELECT confirmed_status, consecutive_failures
         FROM monitor_check_state
         WHERE monitor_id = $1`,
        [monitor.id]
    );

    const savedState = stateResult.rows[0];

    const threshold = Number.isInteger(Number(monitor.failure_threshold))
        && Number(monitor.failure_threshold) >= 1
        && Number(monitor.failure_threshold) <= 10
        ? Number(monitor.failure_threshold)
        : 1;

    let confirmedStatus = savedState?.confirmed_status || null;

    // If no confirmed state is saved, prefer the latest confirmed event.
    if (!confirmedStatus) {
        const eventResult = await db.query(
            `SELECT type
             FROM monitor_events
             WHERE monitor_id = $1
               AND type IN ('UP', 'DOWN')
             ORDER BY created_at DESC, id DESC
             LIMIT 1`,
            [monitor.id]
        );

        confirmedStatus = eventResult.rows[0]?.type || null;
    }

    // Raw history must not bypass a higher failure threshold.
    if (!confirmedStatus) {
        confirmedStatus = threshold === 1
            ? (previousStatus || 'UP')
            : 'UP';
    }

    let consecutiveFailures =
        Number(savedState?.consecutive_failures ?? 0);
    let transition = null;

    if (result.status === 'DOWN') {
        consecutiveFailures += 1;

        if (
            confirmedStatus !== 'DOWN' &&
            consecutiveFailures >= threshold
        ) {
            confirmedStatus = 'DOWN';
            transition = 'DOWN';
        }
    } else {
        consecutiveFailures = 0;

        if (confirmedStatus === 'DOWN') {
            confirmedStatus = 'UP';
            transition = 'UP';
        }
    }

    // Persist confirmed state and failure streak across restarts.
    await db.query(
        `INSERT INTO monitor_check_state
             (monitor_id, confirmed_status, consecutive_failures, updated_at)
         VALUES ($1, $2, $3, NOW())
         ON CONFLICT (monitor_id)
         DO UPDATE SET
             confirmed_status = EXCLUDED.confirmed_status,
             consecutive_failures = EXCLUDED.consecutive_failures,
             updated_at = NOW()`,
        [monitor.id, confirmedStatus, consecutiveFailures]
    );

    // Only confirmed state transitions create monitor events.
    if (transition === 'DOWN') {
        await db.query(
            `INSERT INTO monitor_events (monitor_id, type, message)
             VALUES ($1, $2, $3)`,
            [monitor.id, 'DOWN', 'Service is down']
        );
    } else if (transition === 'UP') {
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
    }

    // Use the confirmed status for alert decisions. This prevents a
    // single unconfirmed failure from being treated as an outage.
    const effectiveResult = {
        ...result,
        status: confirmedStatus
    };

    try {
        await processCheckOutcome(
            monitor,
            effectiveResult,
            transition
        );
    } catch (error) {
        console.error(
            `Alert processing failed (monitor_id: ${monitor.id}):`,
            error
        );
    }

    // Preserve the existing return shape.
    return {
        status: result.status,
        responseTime: result.responseTime,
        statusCode: result.statusCode
    };
}


async function checkMonitor(monitor) {
    let result;

    try {
        if (monitor.monitor_type === 'DNS') {
            const checked = await checkDns(monitor);

            result = {
                status: 'UP',
                responseTime: checked.responseTimeMs,
                statusCode: null,
                dnsTimeMs: checked.dnsTimeMs ?? checked.responseTimeMs ?? null,
                connectTimeMs: null,
                tlsTimeMs: null,
                ttfbTimeMs: null,
                downloadTimeMs: null,
                certificateExpiresAt: null,
                certificateDaysRemaining: null,
                errorType: null,
                errorMessage: null
            };
        } else if (monitor.monitor_type === 'TCP') {
            const checked = await checkTcp(monitor);

            result = {
                status: 'UP',
                responseTime: checked.responseTimeMs,
                statusCode: null,
                dnsTimeMs: checked.dnsTimeMs ?? null,
                connectTimeMs: checked.connectTimeMs ?? null,
                tlsTimeMs: null,
                ttfbTimeMs: null,
                downloadTimeMs: null,
                certificateExpiresAt: null,
                certificateDaysRemaining: null,
                errorType: null,
                errorMessage: null
            };
        } else {
            const checked = await checkHttp(monitor);

            const configuredStatusCodes = monitor.expected_status_codes;
            const statusMatches =
                Array.isArray(configuredStatusCodes) &&
                configuredStatusCodes.length > 0
                    ? configuredStatusCodes.includes(checked.statusCode)
                    : checked.statusCode >= 200 &&
                      checked.statusCode < 400;

            const expectedKeyword =
                typeof monitor.expected_keyword === 'string'
                    ? monitor.expected_keyword.trim()
                    : '';

            const keywordMatches =
                !expectedKeyword ||
                String(checked.body ?? '')
                    .toLowerCase()
                    .includes(expectedKeyword.toLowerCase());

            const maxResponseTimeMs = monitor.max_response_time_ms;
            const responseTimeMatches =
                maxResponseTimeMs == null ||
                checked.responseTimeMs <= maxResponseTimeMs;

            const isUp =
                statusMatches &&
                keywordMatches &&
                responseTimeMatches;

            const failures = [];

            if (!statusMatches) {
                failures.push(
                    Array.isArray(configuredStatusCodes) &&
                    configuredStatusCodes.length > 0
                        ? `Expected HTTP status ${configuredStatusCodes.join(', ')}, received ${checked.statusCode}`
                        : `Monitor returned HTTP ${checked.statusCode}`
                );
            }

            if (!keywordMatches) {
                failures.push(
                    `Response body did not contain the expected keyword "${expectedKeyword}"`
                );
            }

            if (!responseTimeMatches) {
                failures.push(
                    `Response time ${checked.responseTimeMs}ms exceeded the ${maxResponseTimeMs}ms limit`
                );
            }

            result = {
                status: isUp ? 'UP' : 'DOWN',
                responseTime: checked.responseTimeMs,
                statusCode: checked.statusCode,
                dnsTimeMs: checked.dnsTimeMs,
                connectTimeMs: checked.connectTimeMs,
                tlsTimeMs: checked.tlsTimeMs,
                ttfbTimeMs: checked.ttfbTimeMs,
                downloadTimeMs: checked.downloadTimeMs,
                certificateExpiresAt: checked.certificateExpiresAt ?? null,
                certificateDaysRemaining: checked.certificateDaysRemaining ?? null,
                errorType: isUp
                    ? null
                    : !statusMatches
                        ? 'BAD_STATUS'
                        : !keywordMatches
                            ? 'UNEXPECTED_BODY'
                            : 'SLOW_RESPONSE',
                errorMessage: isUp ? null : failures.join('; ')
            };
        }
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

    // Keep database operations outside the checker catch.
    // Database errors must propagate to the caller.
    return saveCheckResult(monitor, result);
}

module.exports = { checkMonitor };
