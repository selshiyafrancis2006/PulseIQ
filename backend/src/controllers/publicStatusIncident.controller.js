const db = require('../config/db');

async function getPublicIncidents(req, res) {
    try {
        const page = await db.query(
            `SELECT id
             FROM status_pages
             WHERE slug = $1 AND is_public = TRUE`,
            [req.params.slug]
        );

        if (!page.rows.length) {
            return res.status(404).json({ message: 'Status page not found' });
        }

        const result = await db.query(
            `SELECT
                i.id, i.title, i.impact, i.status,
                i.created_at, i.updated_at, i.resolved_at,
                COALESCE((
                    SELECT jsonb_agg(
                        jsonb_build_object(
                            'id', u.id,
                            'status', u.status,
                            'message', u.message,
                            'created_at', u.created_at
                        ) ORDER BY u.created_at ASC, u.id ASC
                    )
                    FROM status_page_incident_updates u
                    WHERE u.incident_id = i.id
                ), '[]'::jsonb) AS updates,
                COALESCE((
                    SELECT jsonb_agg(
                        jsonb_build_object('id', m.id, 'name', m.name)
                        ORDER BY m.name
                    )
                    FROM status_page_incident_monitors im
                    JOIN monitors m ON m.id = im.monitor_id
                    WHERE im.incident_id = i.id
                ), '[]'::jsonb) AS affected_monitors
             FROM status_page_incidents i
             WHERE i.status_page_id = $1
             ORDER BY
                CASE WHEN i.status = 'resolved' THEN 1 ELSE 0 END,
                i.updated_at DESC, i.id DESC`,
            [page.rows[0].id]
        );

        res.set('Cache-Control', 'no-store');
        return res.json({ incidents: result.rows });
    } catch (err) {
        console.error('Public incidents error:', err);
        return res.status(500).json({ message: 'Failed to load public incidents' });
    }
}

module.exports = { getPublicIncidents };
