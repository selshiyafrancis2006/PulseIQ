const db = require('../config/db');
const { calculateSlo } = require('../utils/slo');

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

function validateRenotify(value) {
    return Number.isInteger(value) &&
        (value === 0 || (value >= 5 && value <= 1440));
}

const RENOTIFY_ERROR =
    'renotify_minutes must be 0 (disabled) or an integer between 5 and 1440';

function validateMonitorId(value) {
    return /^\d+$/.test(value) && Number.isSafeInteger(Number(value)) &&
        Number(value) > 0;
}
const createMonitor = async (req, res) => {
    try {
        const body = req.body || {};
        const {
            name,
            url,
            tags,
            interval_seconds = 30,
            renotify_minutes = 60
        } = body;

        const nameError = validateName(name);
        if (nameError) return res.status(400).json({ message: nameError });

        const urlError = validateUrl(url);
        if (urlError) return res.status(400).json({ message: urlError });

        if (!validateInterval(interval_seconds)) {
            return res.status(400).json({
                message: 'interval_seconds must be an integer between 30 and 3600'
            });
        }

        if (!validateRenotify(renotify_minutes)) {
            return res.status(400).json({ message: RENOTIFY_ERROR });
        }

        let normalizedTags;
        try {
            normalizedTags = normalizeTags(tags);
        } catch (error) {
            return res.status(400).json({ message: error.message });
        }

        const result = await db.query(
            `INSERT INTO monitors
                (name, url, user_id, tags, interval_seconds, renotify_minutes)
             VALUES ($1, $2, $3, $4, $5, $6)
             RETURNING *`,
            [
                name,
                url,
                req.user.id,
                normalizedTags,
                interval_seconds,
                renotify_minutes
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
                m.renotify_minutes,
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


const selectedRangeCoverageResult = await db.query(
    `WITH monitor_bounds AS (
        SELECT
            GREATEST(
                NOW() - ($3 * INTERVAL '1 hour'),
                m.created_at
            ) AS window_start,
            NOW() AS window_end,
            m.interval_seconds,
            m.created_at
        FROM monitors m
        WHERE m.id = $1
          AND m.user_id = $2
    ),
    checks AS (
        SELECT mr.checked_at, TRUE AS in_window
        FROM monitor_results mr
        CROSS JOIN monitor_bounds b
        WHERE mr.monitor_id = $1
          AND mr.checked_at >= b.window_start
          AND mr.checked_at <= b.window_end

        UNION ALL

        SELECT MAX(mr.checked_at) AS checked_at, FALSE AS in_window
        FROM monitor_results mr
        CROSS JOIN monitor_bounds b
        WHERE mr.monitor_id = $1
          AND mr.checked_at < b.window_start
    ),
    ordered_checks AS (
        SELECT
            checked_at,
            in_window,
            LAG(checked_at) OVER (ORDER BY checked_at) AS previous_check
        FROM checks
        WHERE checked_at IS NOT NULL
    )
        SELECT
        COUNT(*) FILTER (WHERE in_window)::int AS check_count,

        COALESCE(
            BOOL_OR(
                in_window
                AND previous_check >= (
                    SELECT window_start FROM monitor_bounds
                )
                AND EXTRACT(
                    EPOCH FROM (checked_at - previous_check)
                ) > (
                    SELECT interval_seconds * 3 FROM monitor_bounds
                )
            ),
            FALSE
        ) AS has_gap,

        COALESCE(
            EXTRACT(
                EPOCH FROM (NOW() - MAX(checked_at))
            ) > (
                SELECT interval_seconds * 3 FROM monitor_bounds
            ),
            TRUE
        ) AS is_stale,

        COALESCE(
            EXTRACT(EPOCH FROM (
                MIN(checked_at) FILTER (WHERE in_window)
                - (SELECT window_start FROM monitor_bounds)
            )) > (
                SELECT interval_seconds * 3 FROM monitor_bounds
            )
            AND NOT EXISTS (
                SELECT 1
                FROM monitor_results prior
                WHERE prior.monitor_id = $1
                  AND prior.checked_at < (
                      SELECT window_start FROM monitor_bounds
                  )
            ),
            TRUE
        ) AS has_initial_gap

    FROM ordered_checks`,
    [Number(id), req.user.id, windows[range]]
);

const {
    check_count: selectedRangeCheckCount,
    has_gap: selectedRangeHasGap,
    is_stale: selectedRangeIsStale,
    has_initial_gap: selectedRangeHasInitialGap
} = selectedRangeCoverageResult.rows[0];

const coverage =
    selectedRangeCheckCount === 0 ||
    selectedRangeHasGap ||
    selectedRangeIsStale ||
    selectedRangeHasInitialGap
        ? 'insufficient_data'
        : 'complete';



const coverageResult = await db.query(
    `WITH bounds AS (
        SELECT
            GREATEST(
                NOW() - INTERVAL '30 days',
                m.created_at
            ) AS window_start,
            NOW() AS window_end,
            m.interval_seconds * 3 AS gap_threshold_seconds
        FROM monitors m
        WHERE m.id = $1
          AND m.user_id = $2
    ),
    checks AS (
        SELECT mr.checked_at, TRUE AS in_window
        FROM monitor_results mr
        CROSS JOIN bounds b
        WHERE mr.monitor_id = $1
          AND mr.checked_at >= b.window_start
          AND mr.checked_at <= b.window_end

        UNION ALL

        SELECT MAX(mr.checked_at) AS checked_at, FALSE AS in_window
        FROM monitor_results mr
        CROSS JOIN bounds b
        WHERE mr.monitor_id = $1
          AND mr.checked_at < b.window_start
    ),
    ordered_checks AS (
        SELECT
            checked_at,
            in_window,
            LAG(checked_at) OVER (ORDER BY checked_at) AS previous_check
        FROM checks
        WHERE checked_at IS NOT NULL
    )
    SELECT
        COUNT(*) FILTER (WHERE in_window)::int AS check_count,
        COALESCE(
            BOOL_OR(
                in_window
                AND previous_check >= (
                    SELECT window_start FROM bounds
                )
                AND EXTRACT(
                    EPOCH FROM (checked_at - previous_check)
                ) > (
                    SELECT gap_threshold_seconds FROM bounds
                )
            ),
            FALSE
        ) AS has_gap,
        COALESCE(
            EXTRACT(
                EPOCH FROM (NOW() - MAX(checked_at))
            ) > (
                SELECT gap_threshold_seconds FROM bounds
            ),
            TRUE
        ) AS is_stale,
        COALESCE(
            EXTRACT(EPOCH FROM (
                MIN(checked_at) FILTER (WHERE in_window)
                - (SELECT window_start FROM bounds)
            )) > (
                SELECT gap_threshold_seconds FROM bounds
            ),
            TRUE
        ) AS has_initial_gap
    FROM ordered_checks`,
    [Number(id), req.user.id]
);

const {
    check_count,
    has_gap,
    is_stale,
    has_initial_gap
} = coverageResult.rows[0];

const monitoringCoverageInsufficient =
    check_count === 0 ||
    has_gap ||
    is_stale ||
    has_initial_gap;

const eventResult = await db.query(
    `WITH reference_time AS (
        SELECT NOW() AS now
    ),
    previous_event AS (
        SELECT me.type, me.created_at
        FROM monitor_events me
        JOIN monitors m ON m.id = me.monitor_id
        CROSS JOIN reference_time rt
        WHERE me.monitor_id = $1
          AND m.user_id = $2
          AND me.created_at < rt.now - INTERVAL '30 days'
        ORDER BY me.created_at DESC
        LIMIT 1
    ),
    window_events AS (
        SELECT me.type, me.created_at
        FROM monitor_events me
        JOIN monitors m ON m.id = me.monitor_id
        CROSS JOIN reference_time rt
        WHERE me.monitor_id = $1
          AND m.user_id = $2
          AND me.created_at >= rt.now - INTERVAL '30 days'
          AND me.created_at <= rt.now
    )
    SELECT
        events.type,
        events.created_at,
        rt.now AS reference_time
    FROM (
        SELECT type, created_at FROM previous_event
        UNION ALL
        SELECT type, created_at FROM window_events
    ) events
    CROSS JOIN reference_time rt
    ORDER BY events.created_at ASC`,
    [Number(id), req.user.id]
);


const referenceTime = eventResult.rows[0]?.reference_time ?? new Date();

const slo = monitoringCoverageInsufficient
    ? {
        target_percent: 99.9,
        allowed_downtime_minutes: 43.2,
        observed_downtime_minutes: null,
        remaining_budget_minutes: null,
        status: 'insufficient_data'
    }
    : calculateSlo(
        eventResult.rows,
        { now: referenceTime }
    );

return res.json({
    uptime,
    range,
    total_checks,
    up_checks,
    coverage,
    slo
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
        const allowed = [
            'name', 'url', 'tags', 'interval_seconds', 'renotify_minutes'
        ];
        const keys = Object.keys(body);

        if (!keys.length || keys.some(key => !allowed.includes(key))) {
            return res.status(400).json({
                message: 'Provide supported fields: name, url, tags, interval_seconds, renotify_minutes'
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
        const renotify = Object.hasOwn(body, 'renotify_minutes')
            ? body.renotify_minutes : monitor.renotify_minutes;

        const nameError = validateName(name);
        if (nameError) return res.status(400).json({ message: nameError });

        const urlError = validateUrl(url);
        if (urlError) return res.status(400).json({ message: urlError });

        if (!validateInterval(interval)) {
            return res.status(400).json({
                message: 'interval_seconds must be an integer between 30 and 3600'
            });
        }

        if (!validateRenotify(renotify)) {
            return res.status(400).json({ message: RENOTIFY_ERROR });
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
             SET name = $1, url = $2, tags = $3, interval_seconds = $4,
                 renotify_minutes = $5
             WHERE id = $6 AND user_id = $7 RETURNING *`,
            [
                name.trim(),
                url.trim(),
                tags,
                interval,
                renotify,
                Number(id),
                req.user.id
            ]
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
