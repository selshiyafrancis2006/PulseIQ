const express = require('express');
const crypto = require('crypto');
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


router.post('/:id/heartbeat-token', async (req, res) => {
    const monitorId = Number(req.params.id);

    if (!Number.isSafeInteger(monitorId) || monitorId <= 0) {
        return res.status(400).json({ error: 'Invalid monitor ID' });
    }

    try {
        const token = crypto.randomBytes(32).toString('hex');
        const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

        const result = await db.query(
            `UPDATE heartbeat_monitor_secrets s
             SET token_hash = $1
             FROM monitors m
             WHERE s.monitor_id = m.id
               AND m.id = $2
               AND m.user_id = $3
               AND m.monitor_type = 'HEARTBEAT'
             RETURNING s.monitor_id`,
            [tokenHash, monitorId, req.user.id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({
                error: 'Heartbeat monitor not found'
            });
        }

        return res.json({
            monitor_id: monitorId,
            heartbeat_token: token
        });
    } catch (error) {
        console.error('Heartbeat token rotation failed:', error);
        return res.status(500).json({
            error: 'Failed to rotate heartbeat token'
        });
    }
});
module.exports = router;

