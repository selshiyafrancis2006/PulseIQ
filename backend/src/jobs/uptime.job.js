const cron = require('node-cron');

const db = require('../config/db');

const {
    checkMonitor
} = require('../services/uptime.service');

const {
    checkHostStatus
} = require('../services/hostStatus.service');

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