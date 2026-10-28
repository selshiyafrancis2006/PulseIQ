const crypto = require('crypto');
const db = require('../config/db');

function makeSlug() {
    return crypto.randomBytes(12).toString('hex');
}

async function getConfig(req, res) {
    try {
        const pageResult = await db.query(
            'SELECT id, slug, title, description, is_public FROM status_pages WHERE user_id = $1',
            [req.user.id]
        );

        if (!pageResult.rows.length) {
            return res.json({ page: null, monitor_ids: [] });
        }

        const page = pageResult.rows[0];
        const selected = await db.query(
            'SELECT monitor_id FROM status_page_monitors WHERE status_page_id = $1 ORDER BY monitor_id',
            [page.id]
        );

        return res.json({
            page,
            monitor_ids: selected.rows.map(row => row.monitor_id)
        });
    } catch (err) {
        console.error('Status-page config error:', err);
        return res.status(500).json({ message: 'Failed to load status-page configuration' });
    }
}

async function updateConfig(req, res) {
    const body = req.body || {};
    const {
        title,
        description = '',
        is_public = false,
        monitor_ids = []
    } = body;

    if (typeof title !== 'string' || !title.trim() || title.trim().length > 120) {
        return res.status(400).json({ message: 'title must be 1–120 characters' });
    }
    if (typeof description !== 'string' || description.length > 500) {
        return res.status(400).json({ message: 'description must be at most 500 characters' });
    }
    if (typeof is_public !== 'boolean') {
        return res.status(400).json({ message: 'is_public must be a boolean' });
    }
    if (!Array.isArray(monitor_ids) ||
        monitor_ids.length > 100 ||
        monitor_ids.some(id => !Number.isSafeInteger(id) || id <= 0) ||
        new Set(monitor_ids).size !== monitor_ids.length) {
        return res.status(400).json({ message: 'monitor_ids must be unique positive integer IDs' });
    }

    const client = await db.connect();
    try {
        await client.query('BEGIN');

        const owned = await client.query(
            'SELECT id FROM monitors WHERE user_id = $1 AND id = ANY($2::int[])',
            [req.user.id, monitor_ids]
        );

        if (owned.rows.length !== monitor_ids.length) {
            await client.query('ROLLBACK');
            return res.status(400).json({
                message: 'One or more selected monitors do not belong to this account'
            });
        }

        const existing = await client.query(
            'SELECT id, slug FROM status_pages WHERE user_id = $1 FOR UPDATE',
            [req.user.id]
        );

        let page;
        if (existing.rows.length) {
            const updated = await client.query(
                `UPDATE status_pages
                 SET title = $1, description = $2, is_public = $3, updated_at = NOW()
                 WHERE user_id = $4
                 RETURNING id, slug, title, description, is_public`,
                [title.trim(), description, is_public, req.user.id]
            );
            page = updated.rows[0];
        } else {
            const inserted = await client.query(
                `INSERT INTO status_pages (user_id, slug, title, description, is_public)
                 VALUES ($1, $2, $3, $4, $5)
                 RETURNING id, slug, title, description, is_public`,
                [req.user.id, makeSlug(), title.trim(), description, is_public]
            );
            page = inserted.rows[0];
        }

        await client.query(
            'DELETE FROM status_page_monitors WHERE status_page_id = $1',
            [page.id]
        );

        for (const monitorId of monitor_ids) {
            await client.query(
                'INSERT INTO status_page_monitors (status_page_id, monitor_id) VALUES ($1, $2)',
                [page.id, monitorId]
            );
        }

        await client.query('COMMIT');
        return res.json({ page, monitor_ids });
    } catch (err) {
        try { await client.query('ROLLBACK'); } catch (_) {}
        console.error('Status-page update error:', err);
        return res.status(500).json({ message: 'Failed to save status-page configuration' });
    } finally {
        client.release();
    }
}

async function getPublicPage(req, res) {
    try {
        const result = await db.query(
            `SELECT
                sp.title,
                sp.description,
                sp.slug,
                m.id AS monitor_id,
                m.name AS monitor_name,
                CASE
                    WHEN mr.status IS NULL THEN NULL
                    ELSE COALESCE(mcs.confirmed_status, mr.status)
                END AS status,
                mr.response_time_ms,
                mr.checked_at
             FROM status_pages sp
             LEFT JOIN status_page_monitors spm ON spm.status_page_id = sp.id
             LEFT JOIN monitors m ON m.id = spm.monitor_id AND m.is_active = TRUE
             LEFT JOIN LATERAL (
                SELECT status, response_time_ms, checked_at
                FROM monitor_results
                WHERE monitor_id = m.id
                ORDER BY checked_at DESC
                LIMIT 1
                          ) mr ON TRUE
             LEFT JOIN monitor_check_state mcs
                ON mcs.monitor_id = m.id
             WHERE sp.slug = $1 AND sp.is_public = TRUE
             ORDER BY m.name`,
            [req.params.slug]
        );

        if (!result.rows.length) {
            return res.status(404).json({ message: 'Status page not found' });
        }

        const first = result.rows[0];
        const monitors = result.rows
            .filter(row => row.monitor_id !== null)
            .map(row => ({
                id: row.monitor_id,
                name: row.monitor_name,
                status: row.status || 'UNKNOWN',
                response_time_ms: row.response_time_ms,
                checked_at: row.checked_at
            }));

        const states = monitors.map(m => String(m.status).toUpperCase());
        let overall = 'OPERATIONAL';
        if (!monitors.length || states.some(s => s === 'UNKNOWN')) {
            overall = 'UNKNOWN';
        } else if (states.some(s => ['DOWN', 'ERROR', 'FAILED'].includes(s))) {
            overall = 'DEGRADED';
        }

        res.set('Cache-Control', 'no-store');
        return res.json({
            title: first.title,
            description: first.description,
            slug: first.slug,
            overall_status: overall,
            monitors
        });
    } catch (err) {
        console.error('Public status-page error:', err);
        return res.status(500).json({ message: 'Failed to load public status page' });
    }
}

module.exports = { getConfig, updateConfig, getPublicPage };
