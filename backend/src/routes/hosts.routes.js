const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const pool = require('../config/db');

// Accepts either an array of strings or a single comma-separated string
// (the frontend sends an array; this stays defensive for any other caller).
// Trims whitespace, drops empty entries, and de-duplicates.
function normalizeTags(rawTags) {

    if (!rawTags) {
        return [];
    }

    const list = Array.isArray(rawTags)
        ? rawTags
        : String(rawTags).split(',');

    const cleaned = list
        .map(tag => tag.trim())
        .filter(tag => tag.length > 0);

    return [...new Set(cleaned)];
}

router.get('/', async (req, res) => {

    try {

        const { tag } = req.query;

        const result = await pool.query(
            `SELECT id, name, tags, last_seen_at, created_at
             FROM hosts
             WHERE user_id = $1
               AND ($2::text IS NULL OR tags @> ARRAY[$2::text])
             ORDER BY name ASC`,
            [req.user.id, tag || null]
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

        const { name, tags } = req.body;

        if (!name || !name.trim()) {
            return res.status(400).json({
                error: 'Host name is required'
            });
        }

        const trimmedName = name.trim();
        const normalizedTags = normalizeTags(tags);

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
            `INSERT INTO hosts (name, api_key, user_id, tags)
             VALUES ($1, $2, $3, $4)
             RETURNING id, name, api_key, tags, created_at`,
            [trimmedName, apiKey, req.user.id, normalizedTags]
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