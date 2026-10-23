const db = require('../config/db');

// Same normalization used for host tags: trims, drops empties, de-dupes.
// Validate and normalize monitor tags.
function normalizeTags(rawTags) {
    if (rawTags === undefined || rawTags === null || rawTags === '') return [];

    const list = Array.isArray(rawTags) ? rawTags :
        typeof rawTags === 'string' ? rawTags.split(',') : null;

    if (!list || list.some(tag => typeof tag !== 'string')) {
        throw new Error('tags must be a string or an array of strings');
    }

    const cleaned = [...new Set(list.map(tag => tag.trim()).filter(Boolean))];

    if (cleaned.length > 20 || cleaned.some(tag => tag.length > 50)) {
        throw new Error('tags may contain at most 20 entries, each up to 50 characters');
    }
    return cleaned;
}

function validateName(value) {
    return typeof value === 'string' && value.trim().length > 0 &&
        value.trim().length <= 255
        ? null : 'name must be a non-empty string of at most 255 characters';
}

function validateUrl(value) {
    if (typeof value !== 'string' || !value.trim() || value.trim().length > 500) {
        return 'url must be a non-empty string of at most 500 characters';
    }
    try {
        const parsed = new URL(value.trim());
        if (!['http:', 'https:'].includes(parsed.protocol) ||
            parsed.username || parsed.password) {
            return 'url must use HTTP or HTTPS and cannot contain credentials';
        }
    } catch {
        return 'url must be a valid HTTP or HTTPS URL';
    }
    return null;
}

function validateInterval(value) {
    return Number.isInteger(value) && value >= 30 && value <= 3600;
}

function validateMonitorId(value) {
    return /^\d+$/.test(value) && Number.isSafeInteger(Number(value)) &&
        Number(value) > 0;
}
const createMonitor = async (req, res) => {
    try {
        const body = req.body || {};
        const { name, url, tags, interval_seconds = 30 } = body;

        const nameError = validateName(name);
        if (nameError) return res.status(400).json({ message: nameError });

        const urlError = validateUrl(url);
        if (urlError) return res.status(400).json({ message: urlError });

        if (!validateInterval(interval_seconds)) {
            return res.status(400).json({
                message: 'interval_seconds must be an integer between 30 and 3600'
            });
        }

        let normalizedTags;
        try {
            normalizedTags = normalizeTags(tags);
        } catch (error) {
            return res.status(400).json({ message: error.message });
        }

        const result = await db.query(
            `INSERT INTO monitors
                (name, url, user_id, tags, interval_seconds)
             VALUES ($1, $2, $3, $4, $5)
             RETURNING *`,
            [
                name,
                url,
                req.user.id,
                normalizedTags,
                interval_seconds
            ]
        );

        res.status(201).json(result.rows[0]);

    } catch (error) {
        console.error(error);
        res.status(500).json({
            message: 'Failed to create monitor'
        });
    }
};

const getMonitors = async (req, res) => {
    try {

        const result = await db.query(
            'SELECT * FROM monitors WHERE user_id = $1 ORDER BY id DESC',
            [req.user.id]
        );

        res.json(result.rows);

    } catch (error) {

        console.error(error);

        res.status(500).json({
            message: 'Failed to fetch monitors'
        });

    }
};


const getMonitorById = async (req, res) => {
    const { id } = req.params;

    if (!validateMonitorId(id)) {
        return res.status(400).json({ message: 'Invalid monitor ID' });
    }

    try {
        const result = await db.query(
            'SELECT * FROM monitors WHERE id = $1 AND user_id = $2',
            [Number(id), req.user.id]
        );

        if (!result.rows.length) {
            return res.status(404).json({ message: 'Monitor not found' });
        }

        return res.json(result.rows[0]);
    } catch (error) {
        console.error('Fetch monitor failed:', error);
        return res.status(500).json({ message: 'Failed to fetch monitor' });
    }
};
const getMonitorStatus = async (req, res) => {
    try {

        const { tag } = req.query;

        const result = await db.query(`
            SELECT DISTINCT ON (m.id)
                m.id,
                m.name,
                m.url,
                m.tags,
                m.interval_seconds,
                m.is_active,
                mr.status,
                mr.response_time_ms,
                mr.status_code,
                mr.checked_at
            FROM monitors m
            LEFT JOIN monitor_results mr
                ON m.id = mr.monitor_id
            WHERE m.user_id = $1
              AND ($2::text IS NULL OR m.tags @> ARRAY[$2::text])
            ORDER BY m.id, mr.checked_at DESC
        `, [req.user.id, tag || null]);

        res.json(result.rows);

    } catch (error) {

        console.error(error);

        res.status(500).json({
            message: 'Failed to fetch monitor status'
        });

    }
};

const getMonitorHistory = async (req, res) => {
    try {
        const { id } = req.params;

        if (!validateMonitorId(id)) {
    return res.status(400).json({
        message: 'Invalid monitor ID'
    });
}

        const windows = {
    '24h': 24,
    '7d': 168,
    '30d': 720
};

const range = req.query.range || '24h';

if (!Object.hasOwn(windows, range)) {
    return res.status(400).json({
        message: 'Invalid range. Use 24h, 7d, or 30d'
    });
}
        const result = await db.query(
            `WITH ranked_results AS (
    SELECT
        mr.status,
        mr.response_time_ms,
        mr.status_code,
        mr.dns_time_ms,
        mr.connect_time_ms,
        mr.tls_time_ms,
        mr.ttfb_time_ms,
        mr.download_time_ms,
        mr.checked_at,
        ROW_NUMBER() OVER (
            PARTITION BY FLOOR(
                EXTRACT(EPOCH FROM (NOW() - mr.checked_at))
                / ($3 * 3600.0 / 200)
            )
            ORDER BY
                CASE WHEN mr.status = 'DOWN' THEN 0 ELSE 1 END,
                mr.checked_at DESC
        ) AS bucket_rank
    FROM monitor_results mr
    JOIN monitors m ON mr.monitor_id = m.id
    WHERE mr.monitor_id = $1
      AND m.user_id = $2
      AND mr.checked_at >= NOW() - ($3 * INTERVAL '1 hour')
)
SELECT
    status,
    response_time_ms,
    status_code,
    dns_time_ms,
    connect_time_ms,
    tls_time_ms,
    ttfb_time_ms,
    download_time_ms,
    checked_at
FROM ranked_results
WHERE bucket_rank = 1
ORDER BY checked_at DESC
LIMIT 200`,
            [id, req.user.id, windows[range]]
        );

        res.json(result.rows);

    } catch (error) {
        console.error(error);

        res.status(500).json({
            message: 'Failed to fetch monitor history'
        });
    }
};

const getMonitorUptime = async (req, res) => {
    try {
        const { id } = req.params;

        if (!validateMonitorId(id)) {
            return res.status(400).json({
                message: 'Invalid monitor ID'
            });
        }

        const windows = {
            '24h': 24,
            '7d': 168,
            '30d': 720
        };

        const range = req.query.range || '24h';

        if (!Object.hasOwn(windows, range)) {
            return res.status(400).json({
                message: 'Invalid range. Use 24h, 7d, or 30d'
            });
        }

        const result = await db.query(
            `SELECT
                COUNT(mr.id)::int AS total_checks,
                COUNT(mr.id) FILTER (
                    WHERE mr.status = 'UP'
                )::int AS up_checks
             FROM monitors m
             LEFT JOIN monitor_results mr
                ON mr.monitor_id = m.id
                AND mr.checked_at >= NOW() -
                    ($3 * INTERVAL '1 hour')
             WHERE m.id = $1
               AND m.user_id = $2
             GROUP BY m.id`,
            [Number(id), req.user.id, windows[range]]
        );

        if (!result.rows.length) {
            return res.status(404).json({
                message: 'Monitor not found'
            });
        }

        const { total_checks, up_checks } = result.rows[0];

        const uptime = total_checks === 0
            ? null
            : Number(((up_checks / total_checks) * 100).toFixed(2));

        return res.json({
            uptime,
            range,
            total_checks,
            up_checks
        });
    } catch (err) {
        console.error(err);
        return res.status(500).json({
            message: 'Failed to calculate uptime'
        });
    }
};

const getMonitorEvents = async (req, res) => {
  try {
    const { id } = req.params;

    if (!validateMonitorId(id)) {
  return res.status(400).json({ message: 'Invalid monitor ID' });
}

    const result = await db.query(
      `
      SELECT
        me.id,
        me.type,
        me.message,
        me.response_time_ms,
        me.created_at
      FROM monitor_events me
      JOIN monitors m ON me.monitor_id = m.id
      WHERE me.monitor_id = $1
        AND m.user_id = $2
      ORDER BY me.created_at DESC
      LIMIT 100
      `,
      [id, req.user.id]
    );

    res.json(result.rows);

  } catch (error) {
    console.error(error);
    res.status(500).json({
      message: 'Failed to fetch monitor events'
    });
  }
};

const updateMonitor = async (req, res) => {
    const { id } = req.params;
    if (!validateMonitorId(id)) return res.status(400).json({ message: 'Invalid monitor ID' });

    try {
        const body = req.body || {};
        const allowed = ['name', 'url', 'tags', 'interval_seconds'];
        const keys = Object.keys(body);

        if (!keys.length || keys.some(key => !allowed.includes(key))) {
            return res.status(400).json({
                message: 'Provide supported fields: name, url, tags, interval_seconds'
            });
        }

        const current = await db.query(
            'SELECT * FROM monitors WHERE id = $1 AND user_id = $2',
            [Number(id), req.user.id]
        );
        if (!current.rows.length) return res.status(404).json({ message: 'Monitor not found' });

        const monitor = current.rows[0];
        const name = Object.hasOwn(body, 'name') ? body.name : monitor.name;
        const url = Object.hasOwn(body, 'url') ? body.url : monitor.url;
        const interval = Object.hasOwn(body, 'interval_seconds')
            ? body.interval_seconds : monitor.interval_seconds;

        const nameError = validateName(name);
        if (nameError) return res.status(400).json({ message: nameError });

        const urlError = validateUrl(url);
        if (urlError) return res.status(400).json({ message: urlError });

        if (!validateInterval(interval)) {
            return res.status(400).json({
                message: 'interval_seconds must be an integer between 30 and 3600'
            });
        }

        let tags = monitor.tags || [];
        if (Object.hasOwn(body, 'tags')) {
            try {
                tags = normalizeTags(body.tags);
            } catch (error) {
                return res.status(400).json({ message: error.message });
            }
        }

        const result = await db.query(
            `UPDATE monitors
             SET name = $1, url = $2, tags = $3, interval_seconds = $4
             WHERE id = $5 AND user_id = $6 RETURNING *`,
            [name.trim(), url.trim(), tags, interval, Number(id), req.user.id]
        );
        return res.json(result.rows[0]);
    } catch (error) {
        console.error('Update monitor failed:', error);
        return res.status(500).json({ message: 'Failed to update monitor' });
    }
};

const deleteMonitor = async (req, res) => {
    const { id } = req.params;
    if (!validateMonitorId(id)) return res.status(400).json({ message: 'Invalid monitor ID' });

    try {
        const result = await db.query(
            'DELETE FROM monitors WHERE id = $1 AND user_id = $2 RETURNING id',
            [Number(id), req.user.id]
        );
        if (!result.rows.length) return res.status(404).json({ message: 'Monitor not found' });
        return res.json({ message: 'Monitor deleted' });
    } catch (error) {
        console.error('Delete monitor failed:', error);
        return res.status(500).json({ message: 'Failed to delete monitor' });
    }
};

const setMonitorActive = async (req, res, isActive) => {
    const { id } = req.params;
    if (!validateMonitorId(id)) return res.status(400).json({ message: 'Invalid monitor ID' });

    try {
        const result = await db.query(
            `UPDATE monitors SET is_active = $1
             WHERE id = $2 AND user_id = $3 RETURNING *`,
            [isActive, Number(id), req.user.id]
        );
        if (!result.rows.length) return res.status(404).json({ message: 'Monitor not found' });
        return res.json(result.rows[0]);
    } catch (error) {
        console.error('Change monitor state failed:', error);
        return res.status(500).json({ message: 'Failed to change monitor state' });
    }
};

const pauseMonitor = (req, res) => setMonitorActive(req, res, false);
const resumeMonitor = (req, res) => setMonitorActive(req, res, true);
module.exports = {
    createMonitor,
    updateMonitor,
    deleteMonitor,
    pauseMonitor,
    resumeMonitor,
    getMonitors,
    getMonitorById,
    getMonitorStatus,
    getMonitorHistory,
    getMonitorUptime,
    getMonitorEvents
};
