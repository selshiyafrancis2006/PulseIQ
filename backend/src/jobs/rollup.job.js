const cron = require('node-cron');
const {
    rollup5Minute,
    rollup1Hour,
    cleanupRawMetrics,
    cleanupHistoricalData
} = require('../services/metricRollup.service');
// F1: monitor_results rollups + retention
const {
    rollupRecentMonitorResults,
    cleanupMonitorResults
} = require('../services/monitorRollup.service');

// 5-minute rollup — runs every 5 minutes
cron.schedule('*/5 * * * *', async () => {
    try {
        await rollup5Minute();
        console.log('5-minute metric rollup complete');
    } catch (err) {
        console.error('5-minute rollup error:', err);
    }
});

// 1-hour rollup — runs at the top of every hour
cron.schedule('0 * * * *', async () => {
    try {
        await rollup1Hour();
        console.log('1-hour metric rollup complete');
    } catch (err) {
        console.error('1-hour rollup error:', err);
    }
});

// F1: hourly monitor_results rollup — runs at minute 5 of every hour
cron.schedule('5 * * * *', async () => {
    try {
        const buckets = await rollupRecentMonitorResults(3);
        console.log(`Monitor rollup complete: ${buckets} hourly buckets upserted`);
    } catch (err) {
        console.error('Monitor rollup error:', err);
    }
});

// Daily retention cleanup — runs at 3 AM
cron.schedule('0 3 * * *', async () => {
    try {
        const deletedRawMetrics = await cleanupRawMetrics();
        console.log(
            `Retention cleanup: removed ${deletedRawMetrics} raw metric rows older than 3 days`
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

    // F1: monitor_results retention
    try {
        const summary = await cleanupMonitorResults();
        console.log('Monitor results retention complete:', summary);
    } catch (err) {
        console.error('Monitor results retention error:', err);
    }
});