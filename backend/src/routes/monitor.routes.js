const express = require('express');
const router = express.Router();

const db = require('../config/db');

const {
    checkMonitor
} = require('../services/uptime.service');

const {
    createMonitor,
    getMonitors,
    getMonitorStatus,
    getMonitorHistory,
    getMonitorUptime,
    getMonitorEvents
} = require('../controllers/monitor.controller');

router.post('/', createMonitor);

router.get('/', getMonitors);

router.get('/status', getMonitorStatus);

router.get('/:id/history', getMonitorHistory);

router.get('/:id/uptime', getMonitorUptime);

router.get('/:id/events', getMonitorEvents);

router.get('/test', async (req, res) => {
    try {
        const result = await db.query(
            'SELECT * FROM monitors LIMIT 1'
        );

        const monitor = result.rows[0];

        if (!monitor) {
            return res.status(404).json({
                message: 'No monitors found'
            });
        }

        const checkResult = await checkMonitor(monitor);

        res.json(checkResult);

    } catch (error) {
        console.error(error);

        res.status(500).json({
            message: 'Test failed'
        });
    }
});

module.exports = router;