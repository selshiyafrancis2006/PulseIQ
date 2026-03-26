const express = require('express');
const router = express.Router();
const pool = require('./db');

router.get('/metrics', async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT * FROM metrics ORDER BY timestamp DESC LIMIT 20'
        );
        res.json(result.rows);
    }
    catch (err) {
        console.error('ERROR fetching metrics:', err);
        res.status(500).json({ error: 'Failed to fetch metrics'});
    }
});

router.get('/metrics/latest', async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT * FROM metrics ORDER BY timestamp DESC LIMIT 1'
        );
        res.json(result.rows[0]);
    }
    catch (err) {
        console.error('Error fetching latest metric:', err);
        res.status(500).json({ error: 'Failed to fetch latest metric'});
    }
});

router.get('/alerts', async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT * FROM alerts ORDER BY timestamp DESC LIMIT 20'
        );
        res.json(result.rows);
    }
    catch (err) {
        console.error('Error fetching alerts:', err);
        res.status(500).json({ error: 'Failed to fetch alerts' });
    }
});

module.exports = router;