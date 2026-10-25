const db = require('../config/db');

const MAX_DURATION_MINUTES = 30 * 24 * 60;
const MAX_DURATION_MS = MAX_DURATION_MINUTES * 60 * 1000;
const MAX_START_AHEAD_MS = 365 * 24 * 60 * 60 * 1000;
const STATES = ['active', 'upcoming', 'ended'];

function validateId(value) {
    return /^\d+$/.test(value) && Number.isSafeInteger(Number(value)) &&
        Number(value) > 0;
}

function parseDate(value) {
    if (typeof value !== 'string') return null;
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}

// State is computed by the database clock so it always matches the
// clock the uptime job uses when it flags results.
const WINDOW_SELECT = `
    SELECT
        w.id,
        w.monitor_id,
        m.name AS monitor_name,
        w.reason,
        w.starts_at,
        w.ends_at,
        w.created_at,
        CASE
            WHEN NOW() < w.starts_at THEN 'upcoming'
            WHEN NOW() < w.ends_at THEN 'active'
            ELSE 'ended'
        END AS state
    FROM maintenance_windows w
    LEFT JOIN monitors m ON m.id = w.monitor_id`;

const createWindow = async (req, res) => {
    try {
        const body = req.body || {};
        const {
            monitor_id,
            reason,
            starts_at,
            ends_at,
            duration_minutes
        } = body;

        // Scope: one monitor the caller owns, or null for all of them.
        let monitorId = null;

        if (monitor_id !== undefined && monitor_id !== null) {
            if (!Number.isInteger(monitor_id) || monitor_id <= 0) {
                return res.status(400).json({
                    message: 'monitor_id must be a positive integer or null'
                });
            }

            const owned = await db.query(
                'SELECT id FROM monitors WHERE id = $1 AND user_id = $2',
                [monitor_id, req.user.id]
            );

            if (!owned.rows.length) {
                return res.status(404).json({ message: 'Monitor not found' });
            }

            monitorId = monitor_id;
        }

        let cleanReason = null;

        if (reason !== undefined && reason !== null) {
            if (typeof reason !== 'string' || reason.trim().length > 200) {
                return res.status(400).json({
                    message: 'reason must be a string of at most 200 characters'
                });
            }
            cleanReason = reason.trim() || null;
        }

        const nowMs = Date.now();

        // When starts_at is omitted the window starts "now" by the
        // database clock (see the INSERT below).
        let start = null;

        if (starts_at !== undefined && starts_at !== null) {
            start = parseDate(starts_at);

            if (!start) {
                return res.status(400).json({
                    message: 'starts_at must be a valid ISO date-time'
                });
            }

            if (start.getTime() > nowMs + MAX_START_AHEAD_MS) {
                return res.status(400).json({
                    message: 'starts_at can be at most one year ahead'
                });
            }
        }

        const hasEnd = ends_at !== undefined && ends_at !== null;
        const hasDuration =
            duration_minutes !== undefined && duration_minutes !== null;

        if (hasEnd === hasDuration) {
            return res.status(400).json({
                message: 'Provide exactly one of ends_at or duration_minutes'
            });
        }

        let end = null;
        let duration = null;

        if (hasDuration) {
            if (
                !Number.isInteger(duration_minutes) ||
                duration_minutes < 1 ||
                duration_minutes > MAX_DURATION_MINUTES
            ) {
                return res.status(400).json({
                    message: 'duration_minutes must be an integer between 1 and 43200'
                });
            }
            duration = duration_minutes;
        } else {
            end = parseDate(ends_at);

            if (!end) {
                return res.status(400).json({
                    message: 'ends_at must be a valid ISO date-time'
                });
            }

            const effectiveStartMs = start ? start.getTime() : nowMs;

            if (end.getTime() <= effectiveStartMs) {
                return res.status(400).json({
                    message: 'ends_at must be after starts_at'
                });
            }

            if (end.getTime() - effectiveStartMs > MAX_DURATION_MS) {
                return res.status(400).json({
                    message: 'A maintenance window can last at most 30 days'
                });
            }

            if (end.getTime() <= nowMs) {
                return res.status(400).json({
                    message: 'The window must end in the future'
                });
            }
        }

        const inserted = await db.query(
            `INSERT INTO maintenance_windows
                (user_id, monitor_id, reason, starts_at, ends_at)
             SELECT
                $1::int,
                $2::int,
                $3::varchar,
                s.starts_at,
                COALESCE(
                    $5::timestamptz,
                    s.starts_at + ($6::int * INTERVAL '1 minute')
                )
             FROM (
                SELECT COALESCE($4::timestamptz, NOW()) AS starts_at
             ) s
             RETURNING id`,
            [
                req.user.id,
                monitorId,
                cleanReason,
                start ? start.toISOString() : null,
                end ? end.toISOString() : null,
                duration
            ]
        );

        const created = await db.query(
            `${WINDOW_SELECT} WHERE w.id = $1`,
            [inserted.rows[0].id]
        );

        res.status(201).json(created.rows[0]);
    } catch (error) {
        // CHECK (ends_at > starts_at) violated.
        if (error.code === '23514') {
            return res.status(400).json({
                message: 'ends_at must be after starts_at'
            });
        }

        console.error('Create maintenance window failed:', error);
        res.status(500).json({
            message: 'Failed to create maintenance window'
        });
    }
};

const listWindows = async (req, res) => {
    try {
        const { state } = req.query;

        if (state !== undefined && !STATES.includes(state)) {
            return res.status(400).json({
                message: `state must be one of: ${STATES.join(', ')}`
            });
        }

        const result = await db.query(
            `SELECT * FROM (
                ${WINDOW_SELECT}
                WHERE w.user_id = $1
             ) t
             WHERE ($2::text IS NULL OR t.state = $2::text)
             ORDER BY t.starts_at DESC
             LIMIT 100`,
            [req.user.id, state || null]
        );

        res.json(result.rows);
    } catch (error) {
        console.error('List maintenance windows failed:', error);
        res.status(500).json({
            message: 'Failed to fetch maintenance windows'
        });
    }
};

// Ends an active window right now ("unmute").
const endWindow = async (req, res) => {
    const { id } = req.params;
    if (!validateId(id)) {
        return res.status(400).json({ message: 'Invalid maintenance window ID' });
    }

    try {
        const found = await db.query(
            `${WINDOW_SELECT} WHERE w.id = $1 AND w.user_id = $2`,
            [Number(id), req.user.id]
        );

        if (!found.rows.length) {
            return res.status(404).json({
                message: 'Maintenance window not found'
            });
        }

        const current = found.rows[0];

        if (current.state === 'upcoming') {
            return res.status(400).json({
                message: 'This window has not started yet; delete it instead'
            });
        }

        if (current.state === 'ended') {
            return res.status(400).json({
                message: 'This window has already ended'
            });
        }

        await db.query(
            `UPDATE maintenance_windows
             SET starts_at = LEAST(starts_at, NOW() - INTERVAL '1 microsecond'),
                 ends_at = NOW()
             WHERE id = $1 AND user_id = $2`,
            [Number(id), req.user.id]
        );

        const updated = await db.query(
            `${WINDOW_SELECT} WHERE w.id = $1`,
            [Number(id)]
        );

        res.json(updated.rows[0]);
    } catch (error) {
        console.error('End maintenance window failed:', error);
        res.status(500).json({
            message: 'Failed to end maintenance window'
        });
    }
};

const deleteWindow = async (req, res) => {
    const { id } = req.params;
    if (!validateId(id)) {
        return res.status(400).json({ message: 'Invalid maintenance window ID' });
    }

    try {
        const result = await db.query(
            `DELETE FROM maintenance_windows
             WHERE id = $1 AND user_id = $2
             RETURNING id`,
            [Number(id), req.user.id]
        );

        if (!result.rows.length) {
            return res.status(404).json({
                message: 'Maintenance window not found'
            });
        }

        res.json({ message: 'Maintenance window deleted' });
    } catch (error) {
        console.error('Delete maintenance window failed:', error);
        res.status(500).json({
            message: 'Failed to delete maintenance window'
        });
    }
};

module.exports = {
    createWindow,
    listWindows,
    endWindow,
    deleteWindow
};