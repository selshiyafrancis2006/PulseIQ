
const cron = require('node-cron');
const db = require('../config/db');
const { checkMonitor } = require('../services/uptime.service');
const { checkHostStatus } = require('../services/hostStatus.service');

const DEFAULT_MAX_CONCURRENT_MONITORS = 5;
const MIN_MAX_CONCURRENT_MONITORS = 1;
const MAX_ALLOWED_CONCURRENT_MONITORS = 50;

const configuredConcurrency = Number(
    process.env.UPTIME_MAX_CONCURRENT_MONITORS
);

const MAX_CONCURRENT_MONITORS =
    Number.isInteger(configuredConcurrency) &&
    configuredConcurrency >= MIN_MAX_CONCURRENT_MONITORS &&
    configuredConcurrency <= MAX_ALLOWED_CONCURRENT_MONITORS
        ? configuredConcurrency
        : DEFAULT_MAX_CONCURRENT_MONITORS;

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
const inFlight = new Set();
let activeChecks = 0;
let schedulerRunning = false;

async function scheduleDueMonitors() {
    // Prevent overlapping scheduler ticks while the database query is pending.
    if (schedulerRunning) return;
    schedulerRunning = true;

    try {
       const result = await db.query(`
    SELECT
        m.*,
        latest.checked_at AS last_checked_at
    FROM monitors m
    LEFT JOIN LATERAL (
        SELECT checked_at
        FROM monitor_results
        WHERE monitor_id = m.id
        ORDER BY checked_at DESC
        LIMIT 1
    ) latest ON true
    WHERE m.is_active = true
      AND (
          latest.checked_at IS NULL
          OR latest.checked_at <=
              NOW() - (m.interval_seconds * INTERVAL '1 second')
      )
    ORDER BY latest.checked_at ASC NULLS FIRST, m.id ASC
`);

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

            if (
    inFlight.has(monitorId) ||
    activeChecks >= MAX_CONCURRENT_MONITORS
) {
    continue;
}

            // Reserve this monitor before starting asynchronous work.
            inFlight.add(monitorId);
            activeChecks += 1;

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
