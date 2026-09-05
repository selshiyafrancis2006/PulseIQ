const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const pool = require('../config/db');

router.get('/', async (req, res) => {

    try {

        const result = await pool.query(
            `SELECT id, name, last_seen_at, created_at
             FROM hosts
             ORDER BY name ASC`
        );

        res.json(result.rows);

    } catch (err) {

        console.error('Failed to fetch hosts:', err);

        res.status(500).json({
            error: 'Failed to fetch hosts'
        });

    }

});

router.post('/register', async (req, res) => {

    try {

        const { name } = req.body;

        if (!name || !name.trim()) {
            return res.status(400).json({
                error: 'Host name is required'
            });
        }

        const apiKey = crypto.randomUUID();

        const result = await pool.query(
            `INSERT INTO hosts (name, api_key)
             VALUES ($1, $2)
             RETURNING id, name, api_key, created_at`,
            [name.trim(), apiKey]
        );

        res.status(201).json(result.rows[0]);

    } catch (err) {

        console.error('Failed to register host:', err);

        res.status(500).json({
            error: 'Failed to register host'
        });

    }

});

module.exports = router;