const cron = require('node-cron');
const {
    recordRollupSuccess,
    recordRollupFailure,
    getJobState,
    hydrateRollupHealth,
    getRollupHealth
} = require('../services/metricRollupHealth.service');
const { processRollupAlerts } = require('../services/metricRollupAlert.service');
const { saveJobRun, loadJobRunsStrict } = require('../services/jobRunStore.service');
const {
    withMetricRollupLock,
    rollup5Minute,
    rollup1Hour,
    cleanupRawMetrics,
    cleanupCustomMetrics,
    cleanupHistoricalData,
    RAW_RETENTION_DAYS
} = require('../services/metricRollup.service');
// Monitor results rollups and retention
const {
    rollupRecentMonitorResults,
    cleanupMonitorResults
} = require('../services/monitorRollup.service');

// Serialize both metric rollups so the hourly job cannot race the 5-minute job.
let metricRollupQueue = Promise.resolve();

const enqueueMetricRollup = (rollup) => {
    const execution = metricRollupQueue.then(() => rollup());
    metricRollupQueue = execution.catch(() => undefined);
    return execution;
};

// Saves the job's current state so it survives a restart.
const persistJobState = (jobName) => saveJobRun(jobName, getJobState(jobName));

// Hydrate saved health state before stale-health evaluation.
let rollupHealthReady = false;
let rollupHealthLoading = null;

async function ensureRollupHealthReady() {
    if (rollupHealthReady) return true;

    if (!rollupHealthLoading) {
        rollupHealthLoading = loadJobRunsStrict()
            .then((rows) => {
                hydrateRollupHealth(rows);
                rollupHealthReady = true;
                return true;
            })
            .catch((err) => {
                console.error('Could not restore saved job run state:', err);
                return false;
            })
            .finally(() => {
                rollupHealthLoading = null;
            });
    }

    return rollupHealthLoading;
}

// Track metric rollup outcomes without changing their shared execution queue.
async function runTrackedMetricRollup(jobName, rollup, label) {
    try {
        await enqueueMetricRollup(() => withMetricRollupLock((client) => rollup(client)));
        recordRollupSuccess(jobName);
        console.log(`${label} metric rollup complete`);
    } catch (err) {
        recordRollupFailure(jobName, err);
        console.error(`${label} rollup error:`, err);
    }

    await persistJobState(jobName);
}

// 5-minute rollup â€” runs every 5 minutes
cron.schedule('*/5 * * * *', async () => {
    await runTrackedMetricRollup('5m', rollup5Minute, '5-minute');
}, { noOverlap: true });

// 1-hour rollup â€” runs at minute 2 of every hour
cron.schedule('2 * * * *', async () => {
    await runTrackedMetricRollup('1h', rollup1Hour, '1-hour');
}, { noOverlap: true });
// Hourly monitor results rollup â€” runs at minute 5 of every hour
cron.schedule('5 * * * *', async () => {
    try {
        const buckets = await rollupRecentMonitorResults(3);
        console.log(`Monitor rollup complete: ${buckets} hourly buckets upserted`);
    } catch (err) {
        console.error('Monitor rollup error:', err);
    }
});

// Daily retention cleanup â€” runs at 3 AM
cron.schedule('0 3 * * *', async () => {
    // The three cleanup steps are tracked as one job: it counts as successful
    // only when every step finished, and the first error is what is reported.
    let firstError = null;

    try {
        const deletedRawMetrics = await cleanupRawMetrics();
        console.log(
            `Retention cleanup: removed ${deletedRawMetrics} raw metric rows older than ${RAW_RETENTION_DAYS} days`
        );
    } catch (err) {
        firstError = firstError || err;
        console.error('Raw metric retention cleanup error:', err);
    }

    try {
        const deletedCustomMetrics = await cleanupCustomMetrics();
        console.log(
            `Retention cleanup: removed ${deletedCustomMetrics} custom metric rows older than ${RAW_RETENTION_DAYS} days`
        );
    } catch (err) {
        firstError = firstError || err;
        console.error('Custom metric retention cleanup error:', err);
    }
    try {
        const deletedCounts = await cleanupHistoricalData();
        console.log('Historical retention cleanup complete:', deletedCounts);
    } catch (err) {
        firstError = firstError || err;
        console.error('Historical retention cleanup error:', err);
    }

    // Monitor results retention
    try {
        const summary = await cleanupMonitorResults();
        console.log('Monitor results retention complete:', summary);
    } catch (err) {
        firstError = firstError || err;
        console.error('Monitor results retention error:', err);
    }

    if (firstError) {
        recordRollupFailure('cleanup', firstError);
    } else {
        recordRollupSuccess('cleanup');
    }

    await persistJobState('cleanup');
});


// Start hydration during scheduler startup; failed attempts remain retryable.
void ensureRollupHealthReady();

async function runRollupAlertCheck() {
    try {
        const ready = await ensureRollupHealthReady();

        if (!ready) {
            return;
        }

        await processRollupAlerts(getRollupHealth());
    } catch (err) {
        console.error('Metric rollup alert check failed:', err);
    }
}

cron.schedule('* * * * *', runRollupAlertCheck, { noOverlap: true });

module.exports = {
    ensureRollupHealthReady,
    runRollupAlertCheck
};



