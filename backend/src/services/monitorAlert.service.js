const db = require('../config/db');
const { notifyUser } = require('./notification.service');

function readPositiveNumber(value, fallback) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

// A monitor that changes state FLAP_THRESHOLD times within
// FLAP_WINDOW_MINUTES is "flapping". It leaves that state after a full
// window with no changes.
const FLAP_WINDOW_MINUTES = readPositiveNumber(
    process.env.FLAP_WINDOW_MINUTES,
    10
);
const FLAP_THRESHOLD = readPositiveNumber(process.env.FLAP_THRESHOLD, 4);

// Pure decision function (no I/O) so it can be unit-tested directly.
//
// notifiedStatus:       what the user was last told: 'UP' | 'DOWN' | null
// isFlapping:           persisted flapping flag
// status:               result of the check that just ran ('UP' | 'DOWN')
// transition:           'UP' | 'DOWN' if this check changed state, else null
// recentTransitions:    state changes inside the flap window
// renotifyMinutes:      reminder interval for a monitor that stays down
//                       (0 or missing = reminders disabled)
// secondsSinceNotified: seconds since the last notification (null if none)
//
// Returns { notify, next }. notify is the event type to send (or null);
// next is the state to persist when notify is set.
function decideNotification({
    notifiedStatus,
    isFlapping,
    status,
    transition,
    recentTransitions,
    renotifyMinutes,
    secondsSinceNotified
}) {
    if (!isFlapping && recentTransitions >= FLAP_THRESHOLD) {
        return {
            notify: 'FLAPPING',
            next: { notifiedStatus, isFlapping: true }
        };
    }

    if (isFlapping) {
        if (recentTransitions === 0) {
            return {
                notify: 'STABLE',
                next: { notifiedStatus: status, isFlapping: false }
            };
        }

        // Still flapping: stay quiet (no reminders either).
        return { notify: null, next: null };
    }

    if (transition === 'DOWN' && notifiedStatus !== 'DOWN') {
        return {
            notify: 'DOWN',
            next: { notifiedStatus: 'DOWN', isFlapping: false }
        };
    }

    // Only announce a recovery if we announced the outage.
    if (transition === 'UP' && notifiedStatus === 'DOWN') {
        return {
            notify: 'UP',
            next: { notifiedStatus: 'UP', isFlapping: false }
        };
    }

    // Reminder: the outage is already announced, the monitor is still
    // down, and the configured interval has passed since the last message.
    if (
        !transition &&
        status === 'DOWN' &&
        notifiedStatus === 'DOWN' &&
        renotifyMinutes > 0 &&
        secondsSinceNotified != null &&
        secondsSinceNotified >= renotifyMinutes * 60
    ) {
        return {
            notify: 'STILL_DOWN',
            next: { notifiedStatus: 'DOWN', isFlapping: false }
        };
    }

    return { notify: null, next: null };
}

function dispatch(monitor, event) {
    void notifyUser(monitor.user_id, {
        ...event,
        monitor: {
            id: monitor.id,
            name: monitor.name,
            url: monitor.url
        },
        occurredAt: new Date().toISOString()
    }).catch((error) => {
        console.error(
            `Notification dispatch failed (monitor_id: ${monitor.id}):`,
            error
        );
    });
}

// Called after every check, once the result and any state-change event
// have been saved. Checks for one monitor never overlap (the scheduler
// reserves each monitor while it runs), so no row locking is needed.
async function processCheckOutcome(monitor, result, transition) {
    if (!monitor.user_id) return;

    const stateResult = await db.query(
        `INSERT INTO monitor_alert_state (monitor_id)
         VALUES ($1)
         ON CONFLICT (monitor_id)
         DO UPDATE SET monitor_id = EXCLUDED.monitor_id
         RETURNING
             notified_status,
             is_flapping,
             EXTRACT(EPOCH FROM (NOW() - last_notified_at))::int
                 AS seconds_since_notified`,
        [monitor.id]
    );

    const state = stateResult.rows[0];
    if (!state) return;

    let recentTransitions = 0;

    if (transition || state.is_flapping) {
        const recent = await db.query(
            `SELECT COUNT(*)::int AS n
             FROM monitor_events
             WHERE monitor_id = $1
               AND created_at >= NOW() - ($2 * INTERVAL '1 minute')`,
            [monitor.id, FLAP_WINDOW_MINUTES]
        );
        recentTransitions = recent.rows[0]?.n ?? 0;
    }

    const decision = decideNotification({
        notifiedStatus: state.notified_status,
        isFlapping: state.is_flapping,
        status: result.status,
        transition,
        recentTransitions,
        renotifyMinutes: Number(monitor.renotify_minutes ?? 0),
        secondsSinceNotified: state.seconds_since_notified
    });

    if (!decision.notify) return;

    // Persist first: at worst a crash drops one message, it never
    // sends the same alert twice.
    await db.query(
        `UPDATE monitor_alert_state
         SET notified_status = $2,
             is_flapping = $3::boolean,
             flapping_since = CASE
                 WHEN $3::boolean AND NOT is_flapping THEN NOW()
                 WHEN NOT $3::boolean THEN NULL
                 ELSE flapping_since
             END,
             last_notified_at = NOW(),
             updated_at = NOW()
         WHERE monitor_id = $1`,
        [
            monitor.id,
            decision.next.notifiedStatus,
            decision.next.isFlapping
        ]
    );

    const event = {
        type: decision.notify,
        responseTimeMs: result.responseTime,
        statusCode: result.statusCode
    };

    if (decision.notify === 'DOWN' || decision.notify === 'STILL_DOWN') {
        event.message = decision.notify === 'DOWN'
            ? 'Service is down'
            : 'Service is still down';
        event.errorType = result.errorType;
        event.errorMessage = result.errorMessage;
    }

    if (decision.notify === 'UP') {
        event.message = 'Service recovered';
    }

    if (decision.notify === 'FLAPPING') {
        event.message =
            'Monitor is flapping; alerts are paused until it is stable';
        event.transitions = recentTransitions;
        event.windowMinutes = FLAP_WINDOW_MINUTES;
    }

    if (decision.notify === 'STABLE') {
        event.message = 'Monitor stabilized; alerts resumed';
        event.currentStatus = result.status;

        if (result.status === 'DOWN') {
            event.errorType = result.errorType;
            event.errorMessage = result.errorMessage;
        }
    }

    // Outage length, computed in SQL so it never depends on time zones.
    const needsDuration =
        decision.notify === 'UP' ||
        decision.notify === 'STILL_DOWN' ||
        (decision.notify === 'STABLE' && result.status === 'DOWN');

    if (needsDuration) {
        const down = await db.query(
            `SELECT EXTRACT(EPOCH FROM (NOW() - created_at))::int AS seconds
             FROM monitor_events
             WHERE monitor_id = $1 AND type = 'DOWN'
             ORDER BY created_at DESC
             LIMIT 1`,
            [monitor.id]
        );

        event.downForSeconds = down.rows[0]?.seconds ?? null;
    }

    dispatch(monitor, event);
}

module.exports = {
    processCheckOutcome,
    decideNotification,
    FLAP_WINDOW_MINUTES,
    FLAP_THRESHOLD
};