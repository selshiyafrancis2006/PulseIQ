const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const pool = require('../config/db');
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
            `SELECT
    h.id,
    h.name,
    h.tags,
    h.last_seen_at,
    h.created_at,
    m.cpu_usage,
    m.memory_usage,
    m.disk_usage
 FROM hosts h
 LEFT JOIN LATERAL (
    SELECT cpu_usage, memory_usage, disk_usage
    FROM metrics
    WHERE host_id = h.id
    ORDER BY timestamp DESC
    LIMIT 1
 ) m ON true
 WHERE h.user_id = $1
   AND ($2::text IS NULL OR h.tags @> ARRAY[$2::text])
 ORDER BY h.name ASC`,
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

router.get('/:id', async (req, res) => {
    try {
        const { id } = req.params;

        const result = await pool.query(
            `SELECT
                h.id,
                h.name,
                h.tags,
                h.last_seen_at,
                h.created_at,
                m.cpu_usage,
m.memory_usage,
m.disk_usage,
m.network_in,
m.network_out
             FROM hosts h
             LEFT JOIN LATERAL (
                SELECT cpu_usage, memory_usage, disk_usage, network_in, network_out
                FROM metrics
                WHERE host_id = h.id
                ORDER BY timestamp DESC
                LIMIT 1
             ) m ON true
             WHERE h.id = $1
               AND h.user_id = $2`,
            [id, req.user.id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Host not found' });
        }

        res.json(result.rows[0]);
    } catch (err) {
        console.error('Failed to fetch host:', err);
        res.status(500).json({ error: 'Failed to fetch host' });
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