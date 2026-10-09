const cron = require('node-cron');

const db = require('../config/db');

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
            Date.now() - new Date(host.last_seen_at).getTime() > 30000;

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
                console.log(`Host recovered (host_id: ${host.id}, name: ${host.name})`);
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
                  AND last_seen_at < NOW() - INTERVAL '30 seconds'
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
            `, [host.id]);

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

        console.log(
            'Running uptime checks...'
        );

        await checkHostStatus();

        const result =
            await db.query(`
                SELECT *
                FROM monitors
                WHERE is_active = true
            `);

        const monitors =
            result.rows;

        for (const monitor of monitors) {

            await checkMonitor(
                monitor
            );

        }

    } catch (error) {

        console.error(
            'Uptime job error:',
            error
        );

    }

});