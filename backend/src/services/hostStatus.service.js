const db = require('../config/db');
const { notifyUser } = require('./notification.service');

const {
    OFFLINE_THRESHOLD_SECONDS,
    statusSql
} = require('../utils/hostStatus');

async function sendHostLifecycleNotification(userId, event) {
    try {
        await notifyUser(userId, event);
    } catch (error) {
        console.error('Host lifecycle notification failed:', error.message);
    }
}

async function checkHostStatus() {
    // Offline is decided in SQL with the same rule the hosts API uses,
    // so the alerts and the UI can never disagree.
    const result = await db.query(`
        SELECT
            id,
            user_id,
            name,
            last_seen_at,
            (${statusSql('hosts', 1)}) = 'offline' AS is_offline
        FROM hosts
        WHERE last_seen_at IS NOT NULL
    `, [OFFLINE_THRESHOLD_SECONDS]);

    for (const host of result.rows) {
        const lastSeenMs = new Date(host.last_seen_at).getTime();
        const isOffline = host.is_offline;

        // Find the latest persisted host lifecycle event.
        const eventResult = await db.query(`
            SELECT id, metric_name, timestamp
            FROM alerts
            WHERE host_id = $1
              AND metric_name IN ('host_offline', 'host_recovered')
            ORDER BY timestamp DESC, id DESC
            LIMIT 1
        `, [host.id]);

        const latestEvent = eventResult.rows[0];

        if (isOffline) {
            // An existing offline event means this outage is
            // already recorded.
            if (latestEvent?.metric_name === 'host_offline') {
                continue;
            }

            // Insert an offline event only if the host is still
            // stale and no unresolved outage already exists.
            const inserted = await db.query(`
                INSERT INTO alerts (
                    metric_name,
                    metric_value,
                    average_value,
                    severity,
                    host_id,
                    timestamp
                )
                SELECT
                    'host_offline',
                    1,
                    0,
                    'Critical',
                    h.id,
                    NOW()
                FROM hosts h
                WHERE h.id = $1
                  AND h.last_seen_at <
                      NOW() - ($2 * INTERVAL '1 second')
                  AND NOT EXISTS (
                      SELECT 1
                      FROM alerts o
                      WHERE o.host_id = h.id
                        AND o.metric_name = 'host_offline'
                        AND NOT EXISTS (
                            SELECT 1
                            FROM alerts r
                            WHERE r.host_id = h.id
                              AND r.metric_name = 'host_recovered'
                              AND (r.timestamp, r.id) >
                                  (o.timestamp, o.id)
                        )
                  )
                RETURNING id
            `, [host.id, OFFLINE_THRESHOLD_SECONDS]);

            if (inserted.rowCount > 0) {
                console.log(
                    `Host offline alert created (host_id: ${host.id})`
                );

                await sendHostLifecycleNotification(host.user_id, {
                    type: 'HOST_OFFLINE',
                    host: {
                        id: host.id,
                        name: host.name
                    },
                    message: `Host ${host.name} has stopped reporting.`,
                    occurredAt: new Date().toISOString()
                });
            }

            continue;
        }

        // A newer heartbeat after an offline event means the
        // host has returned. Persist one recovery event.
        if (
            latestEvent?.metric_name === 'host_offline' &&
            lastSeenMs > new Date(latestEvent.timestamp).getTime()
        ) {
            const recovered = await db.query(`
                INSERT INTO alerts (
                    metric_name,
                    metric_value,
                    average_value,
                    severity,
                    host_id,
                    timestamp
                )
                SELECT
                    'host_recovered',
                    0,
                    0,
                    'Info',
                    h.id,
                    NOW()
                FROM hosts h
                WHERE h.id = $1
                  AND h.last_seen_at > $2
                  AND EXISTS (
                      SELECT 1
                      FROM alerts o
                      WHERE o.id = $3
                        AND o.host_id = h.id
                        AND o.metric_name = 'host_offline'
                        AND NOT EXISTS (
                            SELECT 1
                            FROM alerts r
                            WHERE r.host_id = h.id
                              AND r.metric_name = 'host_recovered'
                              AND (r.timestamp, r.id) >
                                  (o.timestamp, o.id)
                        )
                  )
                RETURNING id
            `, [
                host.id,
                latestEvent.timestamp,
                latestEvent.id
            ]);

            if (recovered.rowCount > 0) {
                console.log(
                    `Host recovered (host_id: ${host.id}, name: ${host.name})`
                );

                await sendHostLifecycleNotification(host.user_id, {
                    type: 'HOST_RECOVERED',
                    host: {
                        id: host.id,
                        name: host.name
                    },
                    message: `Host ${host.name} is reporting again.`,
                    occurredAt: new Date().toISOString()
                });
            }
        }
    }
}

module.exports = { checkHostStatus };