const cron = require('node-cron');

const db = require('../config/db');

const {
    checkMonitor
} = require('../services/uptime.service');

cron.schedule('*/30 * * * * *', async () => {

    try {

        console.log(
            'Running uptime checks...'
        );

        const result =
            await db.query(`
                SELECT *
                FROM monitors
                WHERE is_active = true
            `);

        const monitors =
            result.rows;

        for (const monitor of monitors) {

            await checkMonitor(
                monitor
            );

        }

    } catch (error) {

        console.error(
            'Uptime job error:',
            error
        );

    }

});