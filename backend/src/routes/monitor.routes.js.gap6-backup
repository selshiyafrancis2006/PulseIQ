const express = require('express');
const router = express.Router();

const db = require('../config/db');

const {
    checkMonitor
} = require('../services/uptime.service');

const {
    createMonitor,
    getMonitors,
    getMonitorById,
    getMonitorStatus,
    getMonitorHistory,
    getMonitorUptime,
    getMonitorEvents,
    updateMonitor,
    deleteMonitor,
    pauseMonitor,
    resumeMonitor,
    getMonitorLocations,
    updateMonitorLocations
} = require('../controllers/monitor.controller');

router.post('/', createMonitor);

router.get('/', getMonitors);

router.get('/status', getMonitorStatus);

router.get('/test', async (req, res) => {
    try {
        const result = await db.query(
            'SELECT * FROM monitors WHERE user_id = $1 LIMIT 1',
            [req.user.id]
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

router.get('/:id/locations', getMonitorLocations);

router.put('/:id/locations', updateMonitorLocations);

router.get('/:id', getMonitorById);

router.get('/:id/history', getMonitorHistory);

router.get('/:id/uptime', getMonitorUptime);

router.get('/:id/events', getMonitorEvents);

router.patch('/:id', updateMonitor);
router.delete('/:id', deleteMonitor);
router.patch('/:id/pause', pauseMonitor);
router.patch('/:id/resume', resumeMonitor);

module.exports = router;
