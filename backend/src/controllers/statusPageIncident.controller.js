const db = require('../config/db');

const IMPACTS = ['minor', 'major', 'critical'];
const STATUSES = ['investigating', 'identified', 'monitoring', 'resolved'];

async function getIncidents(req, res) {
    try {
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
             JOIN status_pages sp ON sp.id = i.status_page_id
             WHERE sp.user_id = $1
             ORDER BY i.created_at DESC, i.id DESC`,
            [req.user.id]
        );

        return res.json({ incidents: result.rows });
    } catch (err) {
        console.error('Load incidents error:', err);
        return res.status(500).json({ message: 'Failed to load incidents' });
    }
}

async function createIncident(req, res) {
    const body = req.body || {};
    const title = body.title;
    const impact = body.impact;
    const message = body.message;
    const monitorIds = body.monitor_ids === undefined ? [] : body.monitor_ids;

    if (typeof title !== 'string' || !title.trim() || title.trim().length > 160) {
        return res.status(400).json({ message: 'title must be 1–160 characters' });
    }
    if (!IMPACTS.includes(impact)) {
        return res.status(400).json({ message: 'impact must be minor, major, or critical' });
    }
    if (typeof message !== 'string' || !message.trim() || message.trim().length > 5000) {
        return res.status(400).json({ message: 'message must be 1–5000 characters' });
    }
    if (!Array.isArray(monitorIds) || monitorIds.length > 100 ||
        monitorIds.some(id => !Number.isSafeInteger(id) || id <= 0) ||
        new Set(monitorIds).size !== monitorIds.length) {
        return res.status(400).json({ message: 'monitor_ids must contain unique positive integer IDs' });
    }

    let client;
    try {
        client = await db.connect();
        await client.query('BEGIN');

        const page = await client.query(
            'SELECT id FROM status_pages WHERE user_id = $1 FOR UPDATE',
            [req.user.id]
        );

        if (!page.rows.length) {
            await client.query('ROLLBACK');
            return res.status(404).json({ message: 'Create a status page before announcing incidents' });
        }

        if (monitorIds.length) {
            const owned = await client.query(
                'SELECT id FROM monitors WHERE user_id = $1 AND id = ANY($2::int[])',
                [req.user.id, monitorIds]
            );

            if (owned.rows.length !== monitorIds.length) {
                await client.query('ROLLBACK');
                return res.status(400).json({ message: 'Every affected monitor must belong to your account' });
            }
        }

        const incident = await client.query(
            `INSERT INTO status_page_incidents (status_page_id, title, impact)
             VALUES ($1, $2, $3)
             RETURNING id, title, impact, status, created_at, updated_at, resolved_at`,
            [page.rows[0].id, title.trim(), impact]
        );

        const incidentId = incident.rows[0].id;

        await client.query(
            `INSERT INTO status_page_incident_updates (incident_id, status, message)
             VALUES ($1, 'investigating', $2)`,
            [incidentId, message.trim()]
        );

        for (const monitorId of monitorIds) {
            await client.query(
                `INSERT INTO status_page_incident_monitors (incident_id, monitor_id)
                 VALUES ($1, $2)`,
                [incidentId, monitorId]
            );
        }

        await client.query('COMMIT');
        return res.status(201).json({
            incident: incident.rows[0],
            monitor_ids: monitorIds
        });
    } catch (err) {
        if (client) { try { await client.query('ROLLBACK'); } catch (_) {} }
        console.error('Create incident error:', err);
        return res.status(500).json({ message: 'Failed to create incident' });
    } finally {
        if (client) client.release();
    }
}

async function addIncidentUpdate(req, res) {
    const incidentId = req.params.id;
    const { status, message } = req.body || {};

    if (!/^[1-9]\d*$/.test(String(incidentId))) {
        return res.status(400).json({ message: 'Invalid incident ID' });
    }
    if (!STATUSES.includes(status)) {
        return res.status(400).json({ message: 'Invalid incident status' });
    }
    if (typeof message !== 'string' || !message.trim() || message.trim().length > 5000) {
        return res.status(400).json({ message: 'message must be 1–5000 characters' });
    }

    let client;
    try {
        client = await db.connect();
        await client.query('BEGIN');

        const owned = await client.query(
            `SELECT i.id, i.status
             FROM status_page_incidents i
             JOIN status_pages sp ON sp.id = i.status_page_id
             WHERE i.id = $1 AND sp.user_id = $2
             FOR UPDATE OF i`,
            [incidentId, req.user.id]
        );

        if (!owned.rows.length) {
            await client.query('ROLLBACK');
            return res.status(404).json({ message: 'Incident not found' });
        }

        if (owned.rows[0].status === 'resolved' && status !== 'investigating') {
            await client.query('ROLLBACK');
            return res.status(409).json({
                message: 'A resolved incident can only be reopened as investigating'
            });
        }

        const updated = await client.query(
            `UPDATE status_page_incidents
             SET status = $1,
                 updated_at = NOW(),
                 resolved_at = CASE WHEN $1 = 'resolved' THEN NOW() ELSE NULL END
             WHERE id = $2
             RETURNING id, title, impact, status, created_at, updated_at, resolved_at`,
            [status, incidentId]
        );

        const history = await client.query(
            `INSERT INTO status_page_incident_updates (incident_id, status, message)
             VALUES ($1, $2, $3)
             RETURNING id, status, message, created_at`,
            [incidentId, status, message.trim()]
        );

        await client.query('COMMIT');
        return res.status(201).json({
            incident: updated.rows[0],
            update: history.rows[0]
        });
    } catch (err) {
        if (client) { try { await client.query('ROLLBACK'); } catch (_) {} }
        console.error('Incident update error:', err);
        return res.status(500).json({ message: 'Failed to update incident' });
    } finally {
        if (client) client.release();
    }
}

module.exports = { getIncidents, createIncident, addIncidentUpdate };


