const cron = require('node-cron');
const {
    rollup5Minute,
    rollup1Hour,
    cleanupRawMetrics,
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

// 5-minute rollup — runs every 5 minutes
cron.schedule('*/5 * * * *', async () => {
    try {
        await enqueueMetricRollup(rollup5Minute);
        console.log('5-minute metric rollup complete');
    } catch (err) {
        console.error('5-minute rollup error:', err);
    }
}, { noOverlap: true });

// 1-hour rollup — runs at minute 2 of every hour
cron.schedule('2 * * * *', async () => {
    try {
        await enqueueMetricRollup(rollup1Hour);
        console.log('1-hour metric rollup complete');
    } catch (err) {
        console.error('1-hour rollup error:', err);
    }
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
    try {
        const deletedRawMetrics = await cleanupRawMetrics();
        console.log(
            `Retention cleanup: removed ${deletedRawMetrics} raw metric rows older than ${RAW_RETENTION_DAYS} days`
        );
    } catch (err) {
        console.error('Raw metric retention cleanup error:', err);
    }

    try {
        const deletedCounts = await cleanupHistoricalData();
        console.log('Historical retention cleanup complete:', deletedCounts);
    } catch (err) {
        console.error('Historical retention cleanup error:', err);
    }

    // Monitor results retention
    try {
        const summary = await cleanupMonitorResults();
        console.log('Monitor results retention complete:', summary);
    } catch (err) {
        console.error('Monitor results retention error:', err);
    }
});