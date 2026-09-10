const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const pool = require('../config/db');

router.get('/', async (req, res) => {

    try {

        const result = await pool.query(
            `SELECT id, name, last_seen_at, created_at
             FROM hosts
             WHERE user_id = $1
             ORDER BY name ASC`,
            [req.user.id]
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

        const trimmedName = name.trim();

        const existing = await pool.query(
            'SELECT id FROM hosts WHERE user_id = $1 AND name = $2',
            [req.user.id, trimmedName]
        );

        if (existing.rows.length > 0) {
            return res.status(409).json({
                error: 'A host with this name already exists'
            });
        }

        const apiKey = crypto.randomUUID();

        const result = await pool.query(
            `INSERT INTO hosts (name, api_key, user_id)
             VALUES ($1, $2, $3)
             RETURNING id, name, api_key, created_at`,
            [trimmedName, apiKey, req.user.id]
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