const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const authenticateAgent = require('../middleware/agentAuth.middleware');
const { evaluateAlerts } = require('../services/alert.service');
const { broadcastMetrics } = require('../services/websocket.service');

router.post('/metrics', authenticateAgent, async (req, res) => {
    try {
        const {
            cpu_usage,
            memory_usage,
            disk_usage,
            network_in,
            network_out
        } = req.body;
        const result = await pool.query(
            `INSERT INTO metrics (
                cpu_usage,
                memory_usage,
                disk_usage,
                network_in,
                network_out,
                host_id
            )
            VALUES ($1, $2, $3, $4, $5, $6)
            RETURNING *`,
            [
                cpu_usage,
                memory_usage,
                disk_usage,
                network_in,
                network_out,
                req.agentHost.id
            ]
        );
        const savedMetric = result.rows[0];
        await evaluateAlerts(savedMetric);
        broadcastMetrics(savedMetric);
        res.status(201).json(savedMetric);
    } catch (err) {
        console.error('Agent metrics ingestion error:', err);
        res.status(500).json({
            error: 'Failed to save metrics'
        });
    }
});

router.post('/traces', authenticateAgent, async (req, res) => {
    try {
        const {
            method,
            route,
            status_code,
            duration_ms
        } = req.body;

        if (!method || !route) {
            return res.status(400).json({
                error: 'method and route are required'
            });
        }

        const result = await pool.query(
            `INSERT INTO traces (
                host_id,
                method,
                route,
                status_code,
                duration_ms
            )
            VALUES ($1, $2, $3, $4, $5)
            RETURNING *`,
            [
                req.agentHost.id,
                method,
                route,
                status_code,
                duration_ms
            ]
        );

        res.status(201).json(result.rows[0]);

    } catch (err) {
        console.error('Agent trace ingestion error:', err);
        res.status(500).json({
            error: 'Failed to save trace'
        });
    }
});

module.exports = router;