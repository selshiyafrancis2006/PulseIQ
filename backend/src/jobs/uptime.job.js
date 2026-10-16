const cron = require('node-cron');

const db = require('../config/db');

const {
    checkMonitor
} = require('../services/uptime.service');

const {
    checkHostStatus
} = require('../services/hostStatus.service');

// Host status: every 10s, so an outage is detected within roughly
// OFFLINE_THRESHOLD_SECONDS + 10s. The guard prevents overlapping runs.
let hostCheckRunning = false;

cron.schedule('*/10 * * * * *', async () => {
    if (hostCheckRunning) return;
    hostCheckRunning = true;

    try {
        await checkHostStatus();
    } catch (error) {
        console.error('Host status check error:', error);
    } finally {
        hostCheckRunning = false;
    }
});

// Uptime monitors: unchanged cadence (every 30s).
let monitorCheckRunning = false;

cron.schedule('*/30 * * * * *', async () => {
    if (monitorCheckRunning) return;
    monitorCheckRunning = true;

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
    } finally {
        monitorCheckRunning = false;
    }
});