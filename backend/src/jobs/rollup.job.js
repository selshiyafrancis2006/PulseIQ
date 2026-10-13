const cron = require('node-cron');
const {
    rollup5Minute,
    rollup1Hour,
    cleanupRawMetrics,
    cleanupHistoricalData
} = require('../services/metricRollup.service');

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
});
