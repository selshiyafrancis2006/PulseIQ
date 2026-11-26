const cron = require('node-cron');
const { runApmAlertCheck } = require('../services/apmAlert.service');

async function runApmAlertJob() {
    try {
        await runApmAlertCheck();
    } catch (err) {
        console.error('APM alert check failed:', err);
    }
}

// Every minute. A rule's `duration` is counted in these evaluations, so
// duration = 3 means "breaching for 3 consecutive minutes".
cron.schedule('* * * * *', runApmAlertJob, { noOverlap: true });

module.exports = {
    runApmAlertJob
};
