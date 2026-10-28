const db = require('../config/db');
const { calculateSlo } = require('../utils/slo');
const { validatePublicTcpTarget } = require('../services/urlSecurity.service');
const { validateDnsTarget } = require('../services/dnsCheck.service');

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

function validateFailureThreshold(value) {
    return Number.isInteger(value) && value >= 1 && value <= 10;
}

const FAILURE_THRESHOLD_ERROR =
    'failure_threshold must be an integer between 1 and 10';

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
            monitor_type = 'HTTP',
            tcp_host,
            tcp_port,
            dns_hostname,
            dns_record_type = 'A',
            tags,
            interval_seconds = 30,
            renotify_minutes = 60,
            failure_threshold = 3
        } = body;

        const nameError = validateName(name);
        if (nameError) return res.status(400).json({ message: nameError });

        if (!['HTTP', 'TCP', 'DNS'].includes(monitor_type)) {
            return res.status(400).json({
                message: 'monitor_type must be HTTP, TCP, or DNS'
            });
        }

        if (!validateInterval(interval_seconds)) {
            return res.status(400).json({
                message: 'interval_seconds must be an integer between 30 and 3600'
            });
        }

        if (!validateRenotify(renotify_minutes)) {
            return res.status(400).json({ message: RENOTIFY_ERROR });
        }

        let storedUrl;
        let storedTcpHost = null;
        let storedTcpPort = null;
        let storedDnsHost = null;
        let storedDnsRecordType = 'A';

        if (monitor_type === 'HTTP') {
            const urlError = validateUrl(url);
            if (urlError) return res.status(400).json({ message: urlError });
            storedUrl = url.trim();
        } else if (monitor_type === 'TCP') {
            let target;
            try {
                target = await validatePublicTcpTarget(tcp_host, tcp_port);
            } catch (error) {
                return res.status(400).json({
                    message: error.message || 'Invalid TCP target'
                });
            }

            storedTcpHost = target.hostname;
            storedTcpPort = target.port;

            const displayHost = storedTcpHost.includes(':')
                ? `[${storedTcpHost}]`
                : storedTcpHost;

            // url is NOT NULL for legacy schema compatibility.
            // TCP checks use tcp_host/tcp_port, never this display value.
            storedUrl = `tcp://${displayHost}:${storedTcpPort}`;
        } else {
            let target;
            try {
                target = validateDnsTarget(dns_hostname, dns_record_type);
            } catch (error) {
                return res.status(400).json({
                    message: error.message || 'Invalid DNS target'
                });
            }

            storedDnsHost = target.hostname;
            storedDnsRecordType = target.recordType;

            // url is NOT NULL for legacy schema compatibility.
            // DNS checks use dns_hostname/dns_record_type, never this display value.
            storedUrl = `dns://${storedDnsHost}/${storedDnsRecordType}`;
        }
        let normalizedTags;
        try {
            normalizedTags = normalizeTags(tags);
        } catch (error) {
            return res.status(400).json({ message: error.message });
        }

        const result = await db.query(
            `INSERT INTO monitors
                (name, url, user_id, tags, interval_seconds,
                 renotify_minutes, failure_threshold, monitor_type,
                 tcp_host, tcp_port, dns_hostname, dns_record_type)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
             RETURNING *`,
            [
                name.trim(),
                storedUrl,
                req.user.id,
                normalizedTags,
                interval_seconds,
                renotify_minutes,
                failure_threshold,
                monitor_type,
                storedTcpHost,
                storedTcpPort,
                storedDnsHost,
                storedDnsRecordType
            ]
        );

        return res.status(201).json(result.rows[0]);
    } catch (error) {
        console.error(error);
        return res.status(500).json({
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

        // One index lookup per monitor for its latest result, instead of
        // joining and sorting every monitor_results row (F2).
        const result = await db.query(`
            SELECT
                m.id,
                m.name,
                m.url,
                m.tags,
                m.interval_seconds,
                m.renotify_minutes,
                m.failure_threshold,
                m.is_active,
                mr.status,
                mr.response_time_ms,
                mr.status_code,
                mr.certificate_expires_at,
                mr.certificate_days_remaining,
                mr.checked_at
            FROM monitors m
            LEFT JOIN LATERAL (
                SELECT
                    status,
                    response_time_ms,
                    status_code,
                    certificate_expires_at,
                    certificate_days_remaining,
                    checked_at
                FROM monitor_results
                WHERE monitor_id = m.id
                ORDER BY checked_at DESC, id DESC
                LIMIT 1
            ) mr ON TRUE
            WHERE m.user_id = $1
              AND ($2::text IS NULL OR m.tags @> ARRAY[$2::text])
            ORDER BY m.id
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
        mr.error_type,
        mr.error_message,
        mr.certificate_expires_at,
        mr.certificate_days_remaining,
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
    error_type,
    error_message,
    certificate_expires_at,
    certificate_days_remaining,
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
            AND mr.in_maintenance = FALSE
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
          AND mr.in_maintenance = FALSE

        UNION ALL

        SELECT MAX(mr.checked_at) AS checked_at, FALSE AS in_window
        FROM monitor_results mr
        CROSS JOIN monitor_bounds b
        WHERE mr.monitor_id = $1
          AND mr.checked_at < b.window_start
          AND mr.in_maintenance = FALSE
    ),
    ordered_checks AS (
        SELECT
            checked_at,
            in_window,
            LAG(checked_at) OVER (ORDER BY checked_at) AS previous_check
        FROM checks
        WHERE checked_at IS NOT NULL
    ),
    latest_check AS (
        SELECT MAX(checked_at) AS checked_at
        FROM ordered_checks
    ),
    maintenance_overlap AS (
        SELECT COALESCE(
            SUM(
                EXTRACT(EPOCH FROM (upper(period) - lower(period)))
            ),
            0
        ) AS seconds
        FROM (
            SELECT unnest(
                range_agg(
                    tstzrange(
                        GREATEST(
                            w.starts_at,
                            lc.checked_at
                        ),
                        LEAST(
                            w.ends_at,
                            b.window_end
                        ),
                        '[)'
                    )
                )
            ) AS period
            FROM latest_check lc
            CROSS JOIN monitor_bounds b
            JOIN maintenance_windows w
              ON w.user_id = $2
             AND (w.monitor_id IS NULL OR w.monitor_id = $1)
             AND w.starts_at < b.window_end
             AND w.ends_at > lc.checked_at
            WHERE lc.checked_at IS NOT NULL
        ) merged
    )
    SELECT
        COUNT(*) FILTER (WHERE in_window)::int AS check_count,



        COALESCE(
            BOOL_OR(
                in_window
                AND previous_check >= (
                    SELECT window_start FROM monitor_bounds
                )
                AND (
                    EXTRACT(
                        EPOCH FROM (checked_at - previous_check)
                    ) - COALESCE((
                        SELECT SUM(
                            EXTRACT(
                                EPOCH FROM (
                                    upper(merged.period) - lower(merged.period)
                                )
                            )
                        )
                        FROM unnest((
                            SELECT range_agg(
                                tstzrange(
                                    GREATEST(
                                        w.starts_at,
                                        ordered_checks.previous_check
                                    ),
                                    LEAST(
                                        w.ends_at,
                                        ordered_checks.checked_at
                                    ),
                                    '[)'
                                )
                            )
                            FROM maintenance_windows w
                            WHERE w.user_id = $2
                              AND (
                                  w.monitor_id IS NULL
                                  OR w.monitor_id = $1
                              )
                              AND w.starts_at < ordered_checks.checked_at
                              AND w.ends_at > ordered_checks.previous_check
                        )) AS merged(period)
                    ), 0)
                ) > (
                    SELECT interval_seconds * 3 FROM monitor_bounds
                )
            ),
            FALSE
        ) AS has_gap,

                COALESCE(
            (
                EXTRACT(EPOCH FROM (
                    MIN(checked_at) FILTER (WHERE in_window)
                    - (SELECT window_start FROM monitor_bounds)
                ))
                - COALESCE((
                    SELECT SUM(
                        EXTRACT(
                            EPOCH FROM (
                                upper(merged.period) - lower(merged.period)
                            )
                        )
                    )
                    FROM unnest((
                        SELECT range_agg(
                            tstzrange(
                                GREATEST(
                                    w.starts_at,
                                    b.window_start
                                ),
                                LEAST(
                                    w.ends_at,
                                    (
                                        SELECT MIN(oc.checked_at)
                                        FROM ordered_checks oc
                                        WHERE oc.in_window
                                    )
                                ),
                                '[)'
                            )
                        )
                        FROM maintenance_windows w
                        CROSS JOIN monitor_bounds b
                        WHERE w.user_id = $2
                          AND (
                              w.monitor_id IS NULL
                              OR w.monitor_id = $1
                          )
                          AND w.starts_at < (
                              SELECT MIN(oc.checked_at)
                              FROM ordered_checks oc
                              WHERE oc.in_window
                          )
                          AND w.ends_at > b.window_start
                    )) AS merged(period)
                ), 0) > (
                    SELECT interval_seconds * 3
                    FROM monitor_bounds
                )
            )
            AND NOT EXISTS (
                SELECT 1
                FROM monitor_results prior
                WHERE prior.monitor_id = $1
                  AND prior.checked_at < (
                      SELECT window_start FROM monitor_bounds
                  )
                  AND prior.in_maintenance = FALSE
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
          AND mr.in_maintenance = FALSE

        UNION ALL

        SELECT MAX(mr.checked_at) AS checked_at, FALSE AS in_window
        FROM monitor_results mr
        CROSS JOIN bounds b
        WHERE mr.monitor_id = $1
          AND mr.checked_at < b.window_start
          AND mr.in_maintenance = FALSE
    ),
    ordered_checks AS (
        SELECT
            checked_at,
            in_window,
            LAG(checked_at) OVER (ORDER BY checked_at) AS previous_check
        FROM checks
        WHERE checked_at IS NOT NULL
    ),
    latest_check AS (
        SELECT MAX(checked_at) AS checked_at
        FROM ordered_checks
    ),
    maintenance_overlap AS (
        SELECT COALESCE(
            SUM(
                EXTRACT(
                    EPOCH FROM (
                        upper(merged.period) - lower(merged.period)
                    )
                )
            ),
            0
        ) AS seconds
        FROM (
            SELECT unnest(
                range_agg(
                    tstzrange(
                        GREATEST(
                            w.starts_at,
                            lc.checked_at
                        ),
                        LEAST(
                            w.ends_at,
                            b.window_end
                        ),
                        '[)'
                    )
                )
            ) AS period
            FROM latest_check lc
            CROSS JOIN bounds b
            JOIN maintenance_windows w
              ON w.user_id = $2
             AND (w.monitor_id IS NULL OR w.monitor_id = $1)
             AND w.starts_at < b.window_end
             AND w.ends_at > lc.checked_at
            WHERE lc.checked_at IS NOT NULL
        ) merged
    )
    SELECT
        COUNT(*) FILTER (WHERE in_window)::int AS check_count,

        COALESCE(
            BOOL_OR(
                in_window
                AND previous_check >= (
                    SELECT window_start FROM bounds
                )
                AND (
                    EXTRACT(
                        EPOCH FROM (checked_at - previous_check)
                    ) - COALESCE((
                        SELECT SUM(
                            EXTRACT(
                                EPOCH FROM (
                                    upper(merged.period)
                                    - lower(merged.period)
                                )
                            )
                        )
                        FROM unnest((
                            SELECT range_agg(
                                tstzrange(
                                    GREATEST(
                                        w.starts_at,
                                        ordered_checks.previous_check
                                    ),
                                    LEAST(
                                        w.ends_at,
                                        ordered_checks.checked_at
                                    ),
                                    '[)'
                                )
                            )
                            FROM maintenance_windows w
                            WHERE w.user_id = $2
                              AND (
                                  w.monitor_id IS NULL
                                  OR w.monitor_id = $1
                              )
                              AND w.starts_at < ordered_checks.checked_at
                              AND w.ends_at > ordered_checks.previous_check
                        )) AS merged(period)
                    ), 0) > (
                        SELECT gap_threshold_seconds FROM bounds
                    )
                )
            ),
            FALSE
        ) AS has_gap,

        COALESCE(
            EXTRACT(
                EPOCH FROM (NOW() - MAX(checked_at))
            ) - (
                SELECT seconds FROM maintenance_overlap
            ) > (
                SELECT gap_threshold_seconds FROM bounds
            ),
            TRUE
        ) AS is_stale,

        COALESCE(
            (
                EXTRACT(EPOCH FROM (
                    MIN(checked_at) FILTER (WHERE in_window)
                    - (SELECT window_start FROM bounds)
                ))
                - COALESCE((
                    SELECT SUM(
                        EXTRACT(
                            EPOCH FROM (
                                upper(merged.period)
                                - lower(merged.period)
                            )
                        )
                    )
                    FROM unnest((
                        SELECT range_agg(
                            tstzrange(
                                GREATEST(
                                    w.starts_at,
                                    b.window_start
                                ),
                                LEAST(
                                    w.ends_at,
                                    (
                                        SELECT MIN(oc.checked_at)
                                        FROM ordered_checks oc
                                        WHERE oc.in_window
                                    )
                                ),
                                '[)'
                            )
                        )
                        FROM maintenance_windows w
                        CROSS JOIN bounds b
                        WHERE w.user_id = $2
                          AND (
                              w.monitor_id IS NULL
                              OR w.monitor_id = $1
                          )
                          AND w.starts_at < (
                              SELECT MIN(oc.checked_at)
                              FROM ordered_checks oc
                              WHERE oc.in_window
                          )
                          AND w.ends_at > b.window_start
                    )) AS merged(period)
                ), 0) > (
                    SELECT gap_threshold_seconds FROM bounds
                )
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
        SELECT
            NOW() AS now,
            GREATEST(
                NOW() - INTERVAL '30 days',
                m.created_at
            ) AS window_start
        FROM monitors m
        WHERE m.id = $1
          AND m.user_id = $2
    ),
    previous_event AS (
        SELECT me.type, me.created_at
        FROM monitor_events me
        CROSS JOIN reference_time rt
        WHERE me.monitor_id = $1
          AND me.created_at < rt.window_start
        ORDER BY me.created_at DESC
        LIMIT 1
    ),
    window_events AS (
        SELECT me.type, me.created_at
        FROM monitor_events me
        CROSS JOIN reference_time rt
        WHERE me.monitor_id = $1
          AND me.created_at >= rt.window_start
          AND me.created_at <= rt.now
    )
    SELECT
        events.type,
        events.created_at,
        rt.now AS reference_time,
        rt.window_start
    FROM (
        SELECT type, created_at FROM previous_event
        UNION ALL
        SELECT type, created_at FROM window_events
    ) events
    CROSS JOIN reference_time rt
    ORDER BY events.created_at ASC`,
    [Number(id), req.user.id]
);

const referenceTime =
    eventResult.rows[0]?.reference_time ?? new Date();

const windowStart =
    eventResult.rows[0]?.window_start ?? referenceTime;
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
        {
            now: referenceTime,
            windowStart
        }
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
    if (!validateMonitorId(id)) {
        return res.status(400).json({ message: 'Invalid monitor ID' });
    }

    try {
        const body = req.body || {};
        const allowed = [
            'name', 'url', 'tcp_host', 'tcp_port',
            'dns_hostname', 'dns_record_type', 'tags',
            'interval_seconds', 'renotify_minutes', 'failure_threshold'
        ];
        const keys = Object.keys(body);

        if (!keys.length || keys.some(key => !allowed.includes(key))) {
            return res.status(400).json({
                message: 'Provide supported monitor fields'
            });
        }

        const current = await db.query(
            'SELECT * FROM monitors WHERE id = $1 AND user_id = $2',
            [Number(id), req.user.id]
        );

        if (!current.rows.length) {
            return res.status(404).json({ message: 'Monitor not found' });
        }

        const monitor = current.rows[0];
        const type = monitor.monitor_type || 'HTTP';

        const hasTcpFields =
            Object.hasOwn(body, 'tcp_host') ||
            Object.hasOwn(body, 'tcp_port');
        const hasDnsFields =
            Object.hasOwn(body, 'dns_hostname') ||
            Object.hasOwn(body, 'dns_record_type');

        if (type === 'HTTP' && (hasTcpFields || hasDnsFields)) {
            return res.status(400).json({
                message: 'TCP and DNS fields cannot be changed on an HTTP monitor'
            });
        }

        if (type === 'TCP' && Object.hasOwn(body, 'url')) {
            return res.status(400).json({
                message: 'The URL cannot be changed on a TCP monitor; update tcp_host and tcp_port instead'
            });
        }

        if (type === 'TCP' && hasDnsFields) {
            return res.status(400).json({
                message: 'DNS fields cannot be changed on a TCP monitor'
            });
        }

        if (type === 'DNS' && (Object.hasOwn(body, 'url') || hasTcpFields)) {
            return res.status(400).json({
                message: 'Update dns_hostname and dns_record_type on a DNS monitor; URL and TCP fields are not supported'
            });
        }

        const name = Object.hasOwn(body, 'name') ? body.name : monitor.name;
        const interval = Object.hasOwn(body, 'interval_seconds')
            ? body.interval_seconds : monitor.interval_seconds;
        const renotify = Object.hasOwn(body, 'renotify_minutes')
            ? body.renotify_minutes : monitor.renotify_minutes;
        const failureThreshold = Object.hasOwn(body, 'failure_threshold')
            ? body.failure_threshold : monitor.failure_threshold;

        const nameError = validateName(name);
        if (nameError) {
            return res.status(400).json({ message: nameError });
        }

        if (!validateInterval(interval)) {
            return res.status(400).json({
                message: 'interval_seconds must be an integer between 30 and 3600'
            });
        }

        if (!validateRenotify(renotify)) {
            return res.status(400).json({ message: RENOTIFY_ERROR });
        }

                if (!validateFailureThreshold(failureThreshold)) {
            return res.status(400).json({ message: FAILURE_THRESHOLD_ERROR });
        }

        if (!validateFailureThreshold(failure_threshold)) {
            return res.status(400).json({ message: FAILURE_THRESHOLD_ERROR });
        }

        let url;
        let tcpHost = null;
        let tcpPort = null;
        let dnsHostname = null;
        let dnsRecordType = 'A';

        if (type === 'TCP') {
            const requestedHost = Object.hasOwn(body, 'tcp_host')
                ? body.tcp_host : monitor.tcp_host;
            const requestedPort = Object.hasOwn(body, 'tcp_port')
                ? body.tcp_port : monitor.tcp_port;

            let target;
            try {
                target = await validatePublicTcpTarget(requestedHost, requestedPort);
            } catch (error) {
                return res.status(400).json({
                    message: error.message || 'Invalid TCP target'
                });
            }

            tcpHost = target.hostname;
            tcpPort = target.port;

            const displayHost = tcpHost.includes(':')
                ? `[${tcpHost}]`
                : tcpHost;

            url = `tcp://${displayHost}:${tcpPort}`;
        } else if (type === 'DNS') {
            const requestedHost = Object.hasOwn(body, 'dns_hostname')
                ? body.dns_hostname : monitor.dns_hostname;
            const requestedRecordType = Object.hasOwn(body, 'dns_record_type')
                ? body.dns_record_type : (monitor.dns_record_type || 'A');

            let target;
            try {
                target = validateDnsTarget(requestedHost, requestedRecordType);
            } catch (error) {
                return res.status(400).json({
                    message: error.message || 'Invalid DNS target'
                });
            }

            dnsHostname = target.hostname;
            dnsRecordType = target.recordType;
            url = `dns://${dnsHostname}/${dnsRecordType}`;
        } else {
            url = Object.hasOwn(body, 'url') ? body.url : monitor.url;
            const urlError = validateUrl(url);
            if (urlError) {
                return res.status(400).json({ message: urlError });
            }
            url = url.trim();
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
                 renotify_minutes = $5, failure_threshold = $6,
                 tcp_host = $7, tcp_port = $8,
                 dns_hostname = $9, dns_record_type = $10
             WHERE id = $11 AND user_id = $12
             RETURNING *`,
            [
                name.trim(),
                url,
                tags,
                interval,
                renotify,
                failureThreshold,
                tcpHost,
                tcpPort,
                dnsHostname,
                dnsRecordType,
                Number(id),
                req.user.id
            ]
        );

        return res.json(result.rows[0]);
    } catch (error) {
        console.error('Update monitor failed:', error);
        return res.status(500).json({
            message: 'Failed to update monitor'
        });
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
