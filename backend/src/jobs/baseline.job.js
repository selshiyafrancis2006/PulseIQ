const cron = require('node-cron');
const {
    recomputeBaselines
} = require('../services/baseline.service');

// Baseline recomputation — runs every 30 minutes
cron.schedule('*/30 * * * *', async () => {
    try {
        await recomputeBaselines();
        console.log('Metric baseline recomputation complete');
    } catch (err) {
        console.error('Baseline recomputation error:', err);
    }
});