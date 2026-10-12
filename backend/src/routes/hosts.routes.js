const express = require('express');
const { generateApiKey, hashApiKey } = require('../utils/apiKey');
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
                h.hostname,
                h.os,
                h.platform,
                h.arch,
                h.cpu_model,
                h.cpu_cores,
                h.total_memory_mb,
                h.ip_address,
                h.agent_version,
                h.boot_time,
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

        if (typeof name !== 'string' || !name.trim()) {
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

        // The plaintext key is returned once and never stored: only its hash is.
        const apiKey = generateApiKey();

        const result = await pool.query(
            `INSERT INTO hosts (name, api_key_hash, user_id, tags)
             VALUES ($1, $2, $3, $4)
             RETURNING id, name, tags, created_at`,
            [trimmedName, hashApiKey(apiKey), req.user.id, normalizedTags]
        );

        res.status(201).json({
            ...result.rows[0],
            api_key: apiKey
        });

    } catch (err) {

        if (err.code === '23505') {
            return res.status(409).json({
                error: 'A host with this name already exists'
            });
        }

        console.error('Failed to register host:', err);

        res.status(500).json({
            error: 'Failed to register host'
        });

    }

});

// ---- ADDITION: edit host name / tags ----
router.patch('/:id', async (req, res) => {

    try {

        const hostId = Number(req.params.id);

        if (!Number.isInteger(hostId) || hostId <= 0) {
            return res.status(404).json({ error: 'Host not found' });
        }

        const { name, tags } = req.body;

        const trimmedName = typeof name === 'string' ? name.trim() : '';

        if (!trimmedName) {
            return res.status(400).json({ error: 'Host name is required' });
        }

        // tags omitted -> leave unchanged; tags sent -> replace
        const normalizedTags = tags === undefined ? null : normalizeTags(tags);

        const duplicate = await pool.query(
            'SELECT id FROM hosts WHERE user_id = $1 AND name = $2 AND id <> $3',
            [req.user.id, trimmedName, hostId]
        );

        if (duplicate.rows.length > 0) {
            return res.status(409).json({
                error: 'A host with this name already exists'
            });
        }

        const result = await pool.query(
            `UPDATE hosts
             SET name = $1,
                 tags = COALESCE($2::text[], tags)
             WHERE id = $3
               AND user_id = $4
             RETURNING id, name, tags`,
            [trimmedName, normalizedTags, hostId, req.user.id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Host not found' });
        }

        res.json(result.rows[0]);

    } catch (err) {

        console.error('Failed to update host:', err);

        res.status(500).json({ error: 'Failed to update host' });

    }

});

// ---- ADDITION: regenerate API key ----
router.post('/:id/regenerate-key', async (req, res) => {

    try {

        const hostId = Number(req.params.id);

        if (!Number.isInteger(hostId) || hostId <= 0) {
            return res.status(404).json({ error: 'Host not found' });
        }

        const apiKey = generateApiKey();

        const result = await pool.query(
            `UPDATE hosts
             SET api_key_hash = $1
             WHERE id = $2
               AND user_id = $3
             RETURNING id, name`,
            [hashApiKey(apiKey), hostId, req.user.id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Host not found' });
        }

        // Shown once, never stored
        res.json({
            ...result.rows[0],
            api_key: apiKey
        });

    } catch (err) {

        console.error('Failed to regenerate API key:', err);

        res.status(500).json({ error: 'Failed to regenerate API key' });

    }

});

router.delete('/:id', async (req, res) => {
    try {
        const { id } = req.params;

        const result = await pool.query(
            `DELETE FROM hosts
             WHERE id = $1
               AND user_id = $2
             RETURNING id, name`,
            [id, req.user.id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({
                error: 'Host not found'
            });
        }

        res.json({
            message: 'Host deleted successfully',
            host: result.rows[0]
        });
    } catch (err) {
        console.error('Failed to delete host:', err);

        res.status(500).json({
            error: 'Failed to delete host'
        });
    }
});

module.exports = router;