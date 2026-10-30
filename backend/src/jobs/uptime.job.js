const cron = require('node-cron');
const db = require('../config/db');
const { checkMonitor } = require('../services/uptime.service');
const { checkHostStatus } = require('../services/hostStatus.service');

const DEFAULT_MAX_CONCURRENT_MONITORS = 5;
const MIN_MAX_CONCURRENT_MONITORS = 1;
const MAX_ALLOWED_CONCURRENT_MONITORS = 50;

const CLAIM_LEASE_SECONDS = 120;
const CLAIM_RENEW_INTERVAL_MS = 30 * 1000;

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

// Per-process monitor scheduling state.
const inFlight = new Set();
let activeChecks = 0;
let schedulerRunning = false;

async function scheduleDueMonitors() {
    if (schedulerRunning) return;

    const availableSlots = MAX_CONCURRENT_MONITORS - activeChecks;
    if (availableSlots <= 0) return;

    schedulerRunning = true;

    try {
        // Atomically claim due monitors. Expired leases can be reclaimed.
        const result = await db.query(
            `
            WITH due AS (
                SELECT id
                FROM monitors
                WHERE is_active = TRUE
                  AND next_check_at <= NOW()
                  AND (
                      check_claimed_until IS NULL
                      OR check_claimed_until <= NOW()
                  )
                ORDER BY next_check_at ASC, id ASC
                FOR UPDATE SKIP LOCKED
                LIMIT $1
            )
            UPDATE monitors AS m
            SET next_check_at =
                    NOW() + make_interval(secs => m.interval_seconds),
                check_claim_token = gen_random_uuid(),
                check_claimed_until =
                    NOW() + make_interval(secs => ${CLAIM_LEASE_SECONDS})
            FROM due
            WHERE m.id = due.id
            RETURNING m.*;
            `,
            [availableSlots]
        );

        for (const monitor of result.rows) {
            const monitorId = monitor.id;
            const claimToken = monitor.check_claim_token;
            const intervalSeconds = Number(monitor.interval_seconds ?? 30);

            // Only the owner of this claim can release it.
            const releaseClaim = async () => {
                await db.query(
                    `
                    UPDATE monitors
                    SET check_claim_token = NULL,
                        check_claimed_until = NULL
                    WHERE id = $1
                      AND check_claim_token = $2::uuid
                    `,
                    [monitorId, claimToken]
                );
            };

            if (
                !Number.isInteger(intervalSeconds) ||
                intervalSeconds < 30 ||
                intervalSeconds > 3600
            ) {
                console.error(
                    `Invalid interval_seconds for monitor ${monitorId}; skipping check`
                );

                try {
                    await releaseClaim();
                } catch (error) {
                    console.error(
                        `Monitor claim release failed (monitor_id: ${monitorId}):`,
                        error
                    );
                }

                continue;
            }

            // Keep the local guard as an additional safeguard.
            if (
                inFlight.has(monitorId) ||
                activeChecks >= MAX_CONCURRENT_MONITORS
            ) {
                try {
                    await releaseClaim();
                } catch (error) {
                    console.error(
                        `Monitor claim release failed (monitor_id: ${monitorId}):`,
                        error
                    );
                }

                continue;
            }

            inFlight.add(monitorId);
            activeChecks += 1;

            let renewalInProgress = false;

            // Renew the lease while the monitor check is running.
            const renewalTimer = setInterval(async () => {
                if (renewalInProgress) return;

                renewalInProgress = true;

                try {
                    const renewal = await db.query(
                        `
                        UPDATE monitors
                        SET check_claimed_until =
                            NOW() + make_interval(secs => ${CLAIM_LEASE_SECONDS})
                        WHERE id = $1
                          AND check_claim_token = $2::uuid
                          AND check_claimed_until > NOW()
                          AND is_active = TRUE
                        RETURNING id
                        `,
                        [monitorId, claimToken]
                    );

                    if (!renewal.rows.length) {
                        console.error(
                            `Monitor claim lease lost (monitor_id: ${monitorId})`
                        );
                    }
                } catch (error) {
                    console.error(
                        `Monitor claim renewal failed (monitor_id: ${monitorId}):`,
                        error
                    );
                } finally {
                    renewalInProgress = false;
                }
            }, CLAIM_RENEW_INTERVAL_MS);

            renewalTimer.unref?.();

            void checkMonitor(monitor)
                .catch((error) => {
                    console.error(
                        `Monitor check failed (monitor_id: ${monitorId}):`,
                        error
                    );
                })
                .finally(async () => {
                    clearInterval(renewalTimer);

                    // Wait for an already-started renewal query to finish
                    // before releasing this claim.
                    while (renewalInProgress) {
                        await new Promise((resolve) =>
                            setTimeout(resolve, 10)
                        );
                    }

                    try {
                        await releaseClaim();
                    } catch (error) {
                        console.error(
                            `Monitor claim release failed (monitor_id: ${monitorId}):`,
                            error
                        );
                    } finally {
                        inFlight.delete(monitorId);
                        activeChecks -= 1;
                    }
                });
        }
    } catch (error) {
        console.error('Uptime scheduler error:', error);
    } finally {
        schedulerRunning = false;
    }
}

// Check every second; individual monitors run according to next_check_at.
cron.schedule('* * * * * *', () => {
    void scheduleDueMonitors();
});

module.exports = {
    scheduleDueMonitors,
    MAX_CONCURRENT_MONITORS
};