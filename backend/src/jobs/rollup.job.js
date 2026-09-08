const cron = require('node-cron');
const {
    rollup5Minute,
    rollup1Hour,
    cleanupRawMetrics
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

// Raw metric retention cleanup — runs once a day at 3 AM
cron.schedule('0 3 * * *', async () => {
    try {
        const deleted = await cleanupRawMetrics();
        console.log(`Retention cleanup: removed ${deleted} raw metric rows older than 3 days`);
    } catch (err) {
        console.error('Retention cleanup error:', err);
    }
});