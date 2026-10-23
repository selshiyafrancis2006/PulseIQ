
const cron = require('node-cron');
const db = require('../config/db');
const { checkMonitor } = require('../services/uptime.service');
const { checkHostStatus } = require('../services/hostStatus.service');

const MAX_CONCURRENT_MONITORS = 5;

// Host status: every 10 seconds. Keep this job independent of monitor checks.
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

// Per-monitor scheduling state.
const nextRunAt = new Map();
const inFlight = new Set();
let activeChecks = 0;
let schedulerRunning = false;

async function scheduleDueMonitors() {
    // Prevent overlapping scheduler ticks while the database query is pending.
    if (schedulerRunning) return;
    schedulerRunning = true;

    try {
        const result = await db.query(`
            SELECT *
            FROM monitors
            WHERE is_active = true
        `);

        const now = Date.now();
        const activeIds = new Set(result.rows.map((monitor) => monitor.id));

        for (const monitor of result.rows) {
            const monitorId = monitor.id;
            const intervalSeconds = Number(monitor.interval_seconds ?? 30);

            if (
                !Number.isInteger(intervalSeconds) ||
                intervalSeconds < 30 ||
                intervalSeconds > 3600
            ) {
                console.error(
                    `Invalid interval_seconds for monitor ${monitorId}; skipping check`
                );
                continue;
            }

            // Run newly discovered monitors immediately.
            if (!nextRunAt.has(monitorId)) {
                nextRunAt.set(monitorId, now);
            }

            if (
                now < nextRunAt.get(monitorId) ||
                inFlight.has(monitorId) ||
                activeChecks >= MAX_CONCURRENT_MONITORS
            ) {
                continue;
            }

            // Reserve this monitor before starting asynchronous work.
            inFlight.add(monitorId);
            activeChecks += 1;
            nextRunAt.set(monitorId, now + intervalSeconds * 1000);

            void checkMonitor(monitor)
                .catch((error) => {
                    console.error(
                        `Monitor check failed (monitor_id: ${monitorId}):`,
                        error
                    );
                })
                .finally(() => {
                    inFlight.delete(monitorId);
                    activeChecks -= 1;
                });
        }

        // Remove scheduler state for deleted or inactive monitors.
        for (const monitorId of nextRunAt.keys()) {
            if (!activeIds.has(monitorId) && !inFlight.has(monitorId)) {
                nextRunAt.delete(monitorId);
            }
        }
    } catch (error) {
        console.error('Uptime scheduler error:', error);
    } finally {
        schedulerRunning = false;
    }
}

// Check every second; individual monitors run according to their intervals.
cron.schedule('* * * * * *', () => {
    void scheduleDueMonitors();
});

module.exports = {
    scheduleDueMonitors,
    MAX_CONCURRENT_MONITORS
};
