const db = require('../config/db');
const { notifyUser } = require('./notification.service');
const {
    HOST_METRIC_ALERT,
    HOST_METRIC_RECOVERED,
    buildHostMetricEvent
} = require('./hostMetricEvents');

// A maintenance window with no monitor (monitor_id IS NULL) covers everything
// the user owns, so it also mutes metric notifications. The alert itself is
// still saved, so history stays complete.
async function isUserMuted(userId) {
    const result = await db.query(
        `SELECT EXISTS (
             SELECT 1
             FROM maintenance_windows
             WHERE user_id = $1
               AND monitor_id IS NULL
               AND NOW() >= starts_at
               AND NOW() < ends_at
         ) AS muted`,
        [userId]
    );

    return result.rows[0]?.muted === true;
}

function buildMetricEvent(change, hostName) {
    const recovered = change.kind === 'recovered';

    return buildHostMetricEvent({
        type: recovered ? HOST_METRIC_RECOVERED : HOST_METRIC_ALERT,
        host: {
            id: change.hostId,
            name: hostName
        },
        rule: {
            metric_name: change.metricName,
            operator: change.operator,
            threshold: change.threshold
        },
        value: change.value,
        severity: recovered ? null : change.severity
    });
}

// All changes from one sample belong to the same host and the same user.
// Never throws: a notification problem must not affect metric ingestion.
async function notifyMetricChanges(changes) {
    if (!Array.isArray(changes) || changes.length === 0) return;

    const { userId, hostId } = changes[0];

    if (await isUserMuted(userId)) return;

    const hostResult = await db.query(
        'SELECT name FROM hosts WHERE id = $1',
        [hostId]
    );

    const hostName = hostResult.rows[0]?.name ?? `Host ${hostId}`;

    for (const change of changes) {
        await notifyUser(userId, buildMetricEvent(change, hostName));
    }
}

module.exports = {
    notifyMetricChanges,
    buildMetricEvent,
    isUserMuted
};