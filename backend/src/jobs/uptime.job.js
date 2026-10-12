const cron = require('node-cron');

const db = require('../config/db');

const OFFLINE_THRESHOLD_SECONDS = Math.max(
    30,
    Number.parseInt(process.env.OFFLINE_THRESHOLD_SECONDS, 10) || 30
);

const recoveredHosts = new Set();

const {
    checkMonitor
} = require('../services/uptime.service');



async function checkHostStatus() {
    const result = await db.query(`
        SELECT id, name, last_seen_at
        FROM hosts
        WHERE last_seen_at IS NOT NULL
    `);

    for (const host of result.rows) {
                             const isOffline =
            Date.now() - new Date(host.last_seen_at).getTime() >
            OFFLINE_THRESHOLD_SECONDS * 1000;

        if (isOffline) {
            recoveredHosts.delete(host.id);
        }

        const existing = await db.query(`
            SELECT id, timestamp
            FROM alerts
            WHERE host_id = $1
              AND metric_name = 'host_offline'
            ORDER BY timestamp DESC
            LIMIT 1
        `, [host.id]);

        const lastAlert = existing.rows[0];

        
        if (!isOffline) {
            if (
                lastAlert &&
                new Date(host.last_seen_at).getTime() >
                    new Date(lastAlert.timestamp).getTime()
            ) {
                if (!recoveredHosts.has(host.id)) {
                    console.log(
                        `Host recovered (host_id: ${host.id}, name: ${host.name})`
                    );

                    recoveredHosts.add(host.id);
                }
            }

            continue;
        }

        const alreadyOffline =
            lastAlert &&
            new Date(lastAlert.timestamp).getTime() >
                new Date(host.last_seen_at).getTime();

        if (!alreadyOffline) {
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
                    id,
                    NOW()
                FROM hosts
                WHERE id = $1
                  AND last_seen_at < NOW() - ($2 * INTERVAL '1 second')
                  AND NOT EXISTS (
                      SELECT 1
                      FROM alerts
                      WHERE host_id = $1
                        AND metric_name = 'host_offline'
                        AND timestamp > (
                            SELECT last_seen_at
                            FROM hosts
                            WHERE id = $1
                        )
                  )
                RETURNING id
            `, [host.id, OFFLINE_THRESHOLD_SECONDS]);

            if (inserted.rowCount > 0) {
                console.log(
                    `Host offline alert created (host_id: ${host.id})`
                );
            }
        }
    }
}


cron.schedule('*/30 * * * * *', async () => {
    try {
        console.log('Checking offline hosts...');
        await checkHostStatus();
    } catch (error) {
        console.error('Host status check error:', error);
    }

    try {
        console.log('Running uptime checks...');

        const result = await db.query(`
            SELECT *
            FROM monitors
            WHERE is_active = true
        `);

        for (const monitor of result.rows) {
            try {
                await checkMonitor(monitor);
            } catch (error) {
                console.error(
                    `Monitor check failed (monitor_id: ${monitor.id}):`,
                    error
                );
            }
        }
    } catch (error) {
        console.error('Uptime job error:', error);
    }
});
