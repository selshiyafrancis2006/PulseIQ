const crypto = require('crypto');
const db = require('../config/db');
const { sendSystemAlert } = require('./notification.service');

const VALID_JOB_NAMES = ['5m', '1h', 'cleanup'];

function createRollupAlertEvent(jobName, health, isStale) {
    return {
        eventId: crypto.randomUUID(),
        type: isStale
            ? 'SYSTEM_ROLLUP_STALE'
            : 'SYSTEM_ROLLUP_RECOVERED',
        jobName,
        lastSuccessAt: health.lastSuccessAt,
        staleAfterSeconds: health.staleAfterSeconds,
        lastSuccessAgeSeconds: health.lastSuccessAgeSeconds,
        lastError: health.lastError,
        consecutiveFailures: health.consecutiveFailures,
        occurredAt: new Date().toISOString()
    };
}

async function deliverPendingEvent(jobName, event) {
    let result;

    try {
        result = await sendSystemAlert(event);
    } catch (error) {
        console.error(
            `Rollup alert delivery failed (${jobName}):`,
            error.message
        );

        return {
            delivered: false,
            reason: 'delivery_error'
        };
    }

    const fullyDelivered = result.configured === true
        && result.delivered > 0
        && result.failed === 0;

    if (!fullyDelivered) {
        return {
            delivered: false,
            reason: result.configured
                ? 'partial_or_failed_delivery'
                : 'no_destinations_configured',
            result
        };
    }

    await db.query(
        `UPDATE metric_rollup_alert_state
         SET pending_event = NULL,
             last_notified_at = NOW(),
             updated_at = NOW()
         WHERE job_name = $1
           AND pending_event->>'eventId' = $2`,
        [jobName, event.eventId]
    );

    return {
        delivered: true,
        result
    };
}

async function processRollupAlert(jobName, health) {
    if (!VALID_JOB_NAMES.includes(jobName)) {
        throw new Error(`Unknown metric rollup job: ${jobName}`);
    }

    if (!health || !['healthy', 'stale'].includes(health.status)) {
        return {
            processed: false,
            reason: 'health_not_evaluable'
        };
    }

    const client = await db.connect();
    let pendingEvent = null;

    try {
        await client.query('BEGIN');

        await client.query(
            `INSERT INTO metric_rollup_alert_state (job_name)
             VALUES ($1)
             ON CONFLICT (job_name) DO NOTHING`,
            [jobName]
        );

        const stateResult = await client.query(
            `SELECT is_stale, pending_event
             FROM metric_rollup_alert_state
             WHERE job_name = $1
             FOR UPDATE`,
            [jobName]
        );

        const state = stateResult.rows[0];

        if (!state) {
            throw new Error(`Could not load alert state for ${jobName}`);
        }

        if (state.pending_event) {
            pendingEvent = state.pending_event;
        } else {
            const currentlyStale = health.status === 'stale';

            if (Boolean(state.is_stale) !== currentlyStale) {
                pendingEvent = createRollupAlertEvent(
                    jobName,
                    health,
                    currentlyStale
                );

                await client.query(
                    `UPDATE metric_rollup_alert_state
                     SET is_stale = $2,
                         pending_event = $3::JSONB,
                         last_transition_at = NOW(),
                         updated_at = NOW()
                     WHERE job_name = $1`,
                    [
                        jobName,
                        currentlyStale,
                        JSON.stringify(pendingEvent)
                    ]
                );
            }
        }

        await client.query('COMMIT');
    } catch (error) {
        try {
            await client.query('ROLLBACK');
        } catch (rollbackError) {
            console.error(
                'Rollup alert transaction rollback failed:',
                rollbackError.message
            );
        }

        throw error;
    } finally {
        client.release();
    }

    if (!pendingEvent) {
        return {
            processed: true,
            eventPending: false
        };
    }

    const delivery = await deliverPendingEvent(jobName, pendingEvent);

    return {
        processed: true,
        eventPending: !delivery.delivered,
        eventType: pendingEvent.type,
        delivery
    };
}

async function processRollupAlerts(rollupHealth) {
    if (!rollupHealth || !rollupHealth.jobs) {
        throw new Error('Valid rollup health data is required');
    }

    const results = {};

    for (const jobName of VALID_JOB_NAMES) {
        results[jobName] = await processRollupAlert(
            jobName,
            rollupHealth.jobs[jobName]
        );
    }

    return results;
}

module.exports = {
    processRollupAlert,
    processRollupAlerts
};
