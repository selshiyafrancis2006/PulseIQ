const express = require('express');
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

module.exports = router;