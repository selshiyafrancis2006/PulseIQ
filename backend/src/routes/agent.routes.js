const express = require('express');
const { randomUUID } = require('crypto');
const {
    BUILT_IN_METRICS,
    METRIC_NAMES,
    isPercentageMetric
} = require('../config/metricRegistry');
const { OPTIONAL_METRICS } = require('../config/metrics');
const router = express.Router();
const pool = require('../config/db');
const authenticateAgent = require('../middleware/agentAuth.middleware');
const { evaluateAlerts } = require('../services/alert.service');
const { broadcastMetrics } = require('../services/websocket.service');
const {
    sanitizeProcesses,
    resolveCollectedAt,
    saveHostProcesses
} = require('../services/hostProcesses.service');
const { validateCustomMetrics } = require('../services/customMetrics.service');
const { saveCustomMetrics } = require('../services/customMetricsIngestion.service');

function cleanString(value, max = 255) {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return trimmed ? trimmed.slice(0, max) : null;
}

function cleanInt(value) {
    const n = Number(value);
    return Number.isFinite(n) && n >= 0 ? Math.round(n) : null;
}

function cleanDate(value) {
    if (!value) return null;
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function sanitizeMetadata(raw) {
    if (!raw || typeof raw !== 'object') return null;

    return {
        hostname: cleanString(raw.hostname),
        os: cleanString(raw.os),
        platform: cleanString(raw.platform, 50),
        arch: cleanString(raw.arch, 50),
        cpu_model: cleanString(raw.cpu_model),
        cpu_cores: cleanInt(raw.cpu_cores),
        total_memory_mb: cleanInt(raw.total_memory_mb),
        ip_address: cleanString(raw.ip_address, 64),
        agent_version: cleanString(raw.agent_version, 50),
        boot_time: cleanDate(raw.boot_time)
    };
}

async function saveHostMetadata(hostId, metadata) {
    await pool.query(
        `UPDATE hosts SET
            hostname = COALESCE($1, hostname),
            os = COALESCE($2, os),
            platform = COALESCE($3, platform),
            arch = COALESCE($4, arch),
            cpu_model = COALESCE($5, cpu_model),
            cpu_cores = COALESCE($6, cpu_cores),
            total_memory_mb = COALESCE($7, total_memory_mb),
            ip_address = COALESCE($8, ip_address),
            agent_version = COALESCE($9, agent_version),
            boot_time = COALESCE($10, boot_time)
         WHERE id = $11`,
        [
            metadata.hostname,
            metadata.os,
            metadata.platform,
            metadata.arch,
            metadata.cpu_model,
            metadata.cpu_cores,
            metadata.total_memory_mb,
            metadata.ip_address,
            metadata.agent_version,
            metadata.boot_time,
            hostId
        ]
    );
}


router.get('/monitors', authenticateAgent, async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT
                m.id,
                m.name,
                m.monitor_type,
                m.url,
                m.method,
                m.headers,
                m.body,
                m.timeout_ms,
                m.expected_status_codes,
                m.expected_keyword,
                m.max_response_time_ms,
                m.interval_seconds,
                m.tcp_host,
                m.tcp_port,
                m.dns_hostname,
                m.dns_record_type
             FROM monitor_locations ml
             JOIN monitors m
               ON m.id = ml.monitor_id
             JOIN hosts h
               ON h.id = ml.host_id
              AND h.user_id = m.user_id
             WHERE ml.host_id = $1
               AND m.is_active = true
               AND m.monitor_type <> 'HEARTBEAT'
             ORDER BY m.id`,
            [req.agentHost.id]
        );

        return res.json({ monitors: result.rows });
    } catch (error) {
        console.error('Agent monitor polling failed:', error);
        return res.status(500).json({
            error: 'Failed to fetch assigned monitors'
        });
    }
});

// ===== G1.3b: agents report probe results for their assigned monitors =====
router.post('/monitor-results', authenticateAgent, async (req, res) => {
    try {
        const body = req.body;

        if (!body || typeof body !== 'object' || Array.isArray(body)) {
            return res.status(400).json({ error: 'Invalid result payload' });
        }

        const {
            monitor_id,
            status,
            response_time_ms,
            status_code,
            error_type,
            error_message
        } = body;

        if (!Number.isSafeInteger(monitor_id) || monitor_id < 1) {
            return res.status(400).json({ error: 'Invalid monitor_id' });
        }

        if (status !== 'UP' && status !== 'DOWN') {
            return res.status(400).json({ error: 'status must be UP or DOWN' });
        }

        if (
            response_time_ms !== undefined &&
            response_time_ms !== null &&
            (!Number.isInteger(response_time_ms) ||
                response_time_ms < 0 ||
                response_time_ms > 2147483647)
        ) {
            return res.status(400).json({ error: 'Invalid response_time_ms' });
        }

        if (
            status_code !== undefined &&
            status_code !== null &&
            (!Number.isInteger(status_code) ||
                status_code < 100 ||
                status_code > 599)
        ) {
            return res.status(400).json({ error: 'Invalid status_code' });
        }

        for (const [field, value] of [
            ['error_type', error_type],
            ['error_message', error_message]
        ]) {
            if (value !== undefined && value !== null && typeof value !== 'string') {
                return res.status(400).json({ error: `Invalid ${field}` });
            }
        }

        // Only a host that is assigned to this monitor, and owned by the
        // same user, may report for it. Anything else looks like "not found".
        const assigned = await pool.query(
            `SELECT 1
               FROM monitor_locations ml
               JOIN monitors m ON m.id = ml.monitor_id
               JOIN hosts h ON h.id = ml.host_id AND h.user_id = m.user_id
              WHERE ml.monitor_id = $1
                AND ml.host_id = $2
                AND m.is_active = true`,
            [monitor_id, req.agentHost.id]
        );

        if (assigned.rows.length === 0) {
            return res.status(404).json({ error: 'Monitor not assigned to this agent' });
        }

        // checked_at is always the server's clock, never the agent's, so a
        // skewed agent clock cannot reorder or backdate results.
        const result = await pool.query(
            `INSERT INTO monitor_location_results
                (monitor_id, host_id, status, response_time_ms,
                 status_code, error_type, error_message)
             VALUES ($1, $2, $3, $4, $5, $6, $7)
             RETURNING id, monitor_id, host_id, status, checked_at`,
            [
                monitor_id,
                req.agentHost.id,
                status,
                response_time_ms ?? null,
                status_code ?? null,
                cleanString(error_type, 50),
                cleanString(error_message, 1000)
            ]
        );

        return res.status(201).json(result.rows[0]);
    } catch (error) {
        console.error('Agent monitor result ingestion failed:', error);
        return res.status(500).json({ error: 'Failed to save monitor result' });
    }
});
// ===== end G1.3b =====

router.post('/metrics', authenticateAgent, async (req, res) => {
    try {
        const {
            cpu_usage,
            memory_usage,
            disk_usage,
            network_in,
            network_out,
            sample_id,
            collected_at
        } = req.body;

        const metricValues = Object.fromEntries(
            METRIC_NAMES.map(name => [name, req.body[name]])
        );

        // Optional metrics are accepted only when supplied by the agent.
        for (const key of OPTIONAL_METRICS) {
            const value = req.body[key];

            if (value !== undefined && value !== null) {
                metricValues[key] = value;
            }
        }

        for (const [key, value] of Object.entries(metricValues)) {
            if (OPTIONAL_METRICS.includes(key) && (value === undefined || value === null)) {
                continue;
            }

            if (
                typeof value !== 'number' ||
                !Number.isFinite(value) ||
                value < 0 ||
                (isPercentageMetric(key) && value > 100)
            ) {
                return res.status(400).json({
                    error: `Invalid metric value: ${key}`
                });
            }
        }

        if (
            sample_id !== undefined &&
            (
                typeof sample_id !== 'string' ||
                !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(sample_id)
            )
        ) {
            return res.status(400).json({ error: 'Invalid sample_id' });
        }

        let collectedAt = null;

        if (collected_at !== undefined) {
            const timestampParts = typeof collected_at === 'string'
                ? collected_at.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(Z|([+-])(\d{2}):(\d{2}))$/i)
                : null;

            if (!timestampParts) {
                return res.status(400).json({ error: 'Invalid collected_at' });
            }

            const year = Number(timestampParts[1]);
            const month = Number(timestampParts[2]);
            const day = Number(timestampParts[3]);
            const hour = Number(timestampParts[4]);
            const minute = Number(timestampParts[5]);
            const second = Number(timestampParts[6]);
            const offsetHour = Number(timestampParts[9] || 0);
            const offsetMinute = Number(timestampParts[10] || 0);

            const isLeapYear =
                year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);

            const daysInMonth = [
                31, isLeapYear ? 29 : 28, 31, 30, 31, 30,
                31, 31, 30, 31, 30, 31
            ];

            if (
                year < 1 ||
                month < 1 ||
                month > 12 ||
                day < 1 ||
                day > daysInMonth[month - 1] ||
                hour > 23 ||
                minute > 59 ||
                second > 59 ||
                offsetHour > 23 ||
                offsetMinute > 59
            ) {
                return res.status(400).json({ error: 'Invalid collected_at' });
            }

            const parsedDate = new Date(collected_at);

            if (
                Number.isNaN(parsedDate.getTime()) ||
                parsedDate.getTime() > Date.now() + 5 * 60 * 1000
            ) {
                return res.status(400).json({ error: 'Invalid collected_at' });
            }

            collectedAt = parsedDate.toISOString();
        }

        const client = await pool.connect();
        let savedMetric;

        try {
            await client.query('BEGIN');

            const effectiveSampleId = sample_id || randomUUID();
            const effectiveCollectedAt = collectedAt || new Date().toISOString();

            const result = await client.query(
                `INSERT INTO metrics (
                    cpu_usage,
                    memory_usage,
                    disk_usage,
                    network_in,
                    network_out,
                    host_id,
                    sample_id,
                    collected_at,
                    load_avg,
                    swap_usage
                )
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
                ON CONFLICT (host_id, sample_id) DO NOTHING
                RETURNING *`,
                [
                    cpu_usage,
                    memory_usage,
                    disk_usage,
                    network_in,
                    network_out,
                    req.agentHost.id,
                    effectiveSampleId,
                    effectiveCollectedAt,
                    metricValues.load_avg ?? null,
                    metricValues.swap_usage ?? null
                ]
            );

            savedMetric = result.rows[0];

            if (!savedMetric) {
                const existing = await client.query(
                    `SELECT *
                     FROM metrics
                     WHERE host_id = $1 AND sample_id = $2`,
                    [req.agentHost.id, effectiveSampleId]
                );

                if (!existing.rows[0]) {
                    throw new Error(
                        'Conflicting metric sample could not be retrieved'
                    );
                }

                savedMetric = existing.rows[0];
                await client.query('COMMIT');
                return res.status(200).json(savedMetric);
            }

            const observations = BUILT_IN_METRICS
                .filter(({ name }) =>
                    metricValues[name] !== undefined &&
                    metricValues[name] !== null
                )
                .map(({ name, unit }) => ({
                    metric_name: name,
                    value: metricValues[name],
                    unit,
                    tags: {}
                }));

            await client.query(
                `INSERT INTO metric_observations (
                    host_id,
                    sample_id,
                    metric_name,
                    value,
                    unit,
                    tags,
                    collected_at
                )
                SELECT
                    $1,
                    $2,
                    observation.metric_name,
                    observation.value,
                    observation.unit,
                    COALESCE(observation.tags, '{}'::jsonb),
                    $4
                FROM jsonb_to_recordset($3::jsonb) AS observation(
                    metric_name TEXT,
                    value DOUBLE PRECISION,
                    unit TEXT,
                    tags JSONB
                )
                ON CONFLICT (host_id, sample_id, metric_name, tags)
                DO NOTHING`,
                [
                    req.agentHost.id,
                    effectiveSampleId,
                    JSON.stringify(observations),
                    effectiveCollectedAt
                ]
            );

            await client.query(
                'UPDATE hosts SET last_seen_at = NOW() WHERE id = $1',
                [req.agentHost.id]
            );

            await client.query('COMMIT');
        } catch (dbErr) {
            await client.query('ROLLBACK');
            throw dbErr;
        } finally {
            client.release();
        }
        // Host metadata is optional and must never break metric ingestion.
        const metadata = sanitizeMetadata(req.body.metadata);
        if (metadata) {
            try {
                await saveHostMetadata(req.agentHost.id, metadata);
            } catch (metaErr) {
                console.error('Failed to save host metadata:', metaErr);
            }
        }

        // Run side effects only for newly inserted samples.
        const sideEffects = [
            ['evaluateAlerts', () => evaluateAlerts(savedMetric)],
            ['broadcastMetrics', () => broadcastMetrics(savedMetric)]
        ];

        for (const [label, run] of sideEffects) {
            try {
                await run();
            } catch (sideEffectErr) {
                console.error(
                    `Post-ingestion step failed (${label}, host_id: ${req.agentHost.id}):`,
                    sideEffectErr
                );
            }
        }

        res.status(201).json(savedMetric);
    } catch (err) {
        console.error('Agent metrics ingestion error:', err);
        res.status(500).json({
            error: 'Failed to save metrics'
        });
    }
});
router.post('/custom-metrics', authenticateAgent, async (req, res) => {
    try {
        const validation = validateCustomMetrics(req.body);

        if (validation.error) {
            return res.status(400).json({ error: validation.error });
        }

        const sample = validation.value;
        const result = await saveCustomMetrics(req.agentHost.id, sample);

        return res.status(result.inserted > 0 ? 201 : 200).json({
            sample_id: sample.sample_id,
            inserted: result.inserted,
            duplicates: result.duplicates,
            observations: result.observations
        });
    } catch (err) {
        console.error('Agent custom metrics ingestion error:', err);

        return res.status(500).json({
            error: 'Failed to save custom metrics'
        });
    }
});
// Latest process snapshot of this host. Replaces the previous one; a late
// retry of an older snapshot is accepted but ignored.
router.post('/processes', authenticateAgent, async (req, res) => {
    try {
        const body = req.body;

        if (!body || typeof body !== 'object' || Array.isArray(body)) {
            return res.status(400).json({ error: 'Invalid processes payload' });
        }

        if (!Array.isArray(body.processes)) {
            return res.status(400).json({ error: 'processes must be an array' });
        }

        const processes = sanitizeProcesses(body.processes);

        const stored = await saveHostProcesses(
            req.agentHost.id,
            resolveCollectedAt(body.collected_at),
            processes
        );

        return res.status(stored ? 201 : 200).json({
            host_id: req.agentHost.id,
            count: processes.length,
            stored
        });
    } catch (err) {
        console.error('Failed to save host processes:', err);
        return res.status(500).json({ error: 'Failed to save processes' });
    }
});

router.post('/traces', authenticateAgent, async (req, res) => {
    try {
        const body = req.body;

        if (!body || typeof body !== 'object' || Array.isArray(body)) {
            return res.status(400).json({ error: 'Invalid trace payload' });
        }

        const { method, route, status_code, duration_ms, service } = body;

        if (
            typeof method !== 'string' ||
            !method.trim() ||
            method.trim().length > 10 ||
            /[\x00-\x1F\x7F]/.test(method)
        ) {
            return res.status(400).json({ error: 'Invalid method' });
        }

        if (
            typeof route !== 'string' ||
            !route.trim() ||
            route.trim().length > 255 ||
            /[\x00-\x1F\x7F]/.test(route)
        ) {
            return res.status(400).json({ error: 'Invalid route' });
        }

        if (
            status_code !== undefined &&
            status_code !== null &&
            (!Number.isInteger(status_code) ||
                status_code < 100 ||
                status_code > 599)
        ) {
            return res.status(400).json({ error: 'Invalid status_code' });
        }

        if (
            duration_ms !== undefined &&
            duration_ms !== null &&
            (!Number.isInteger(duration_ms) ||
                duration_ms < 0 ||
                duration_ms > 2147483647)
        ) {
            return res.status(400).json({ error: 'Invalid duration_ms' });
        }

        const serviceProblem = validateService(service);

        if (serviceProblem) {
            return res.status(400).json({ error: serviceProblem });
        }

        const result = await pool.query(
            `INSERT INTO traces
                (host_id, method, route, status_code, duration_ms, service)
             VALUES ($1, $2, $3, $4, $5, $6)
             RETURNING *`,
            [
                req.agentHost.id,
                method.trim().toUpperCase(),
                route.trim(),
                status_code ?? null,
                duration_ms ?? null,
                normalizeService(service)
            ]
        );

        return res.status(201).json(result.rows[0]);
    } catch (err) {
        console.error('Agent trace ingestion error:', err);
        return res.status(500).json({
            error: 'Failed to save trace'
        });
    }
});

// ---- APM batch ingestion -------------------------------------------------
const MAX_TRACE_BATCH_SIZE = 100;
const TRACE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const TRACE_MAX_FUTURE_MS = 60 * 1000;

function validateService(service) {
    if (service === undefined || service === null) {
        return null;
    }

    if (
        typeof service !== 'string' ||
        service.trim().length > 100 ||
        /[\x00-\x1F\x7F]/.test(service)
    ) {
        return 'Invalid service';
    }

    return null;
}

// Optional field: an empty or missing service is stored as NULL.
function normalizeService(service) {
    return typeof service === 'string' && service.trim()
        ? service.trim()
        : null;
}

function validateTraceInput(trace) {
    if (!trace || typeof trace !== 'object' || Array.isArray(trace)) {
        return 'Invalid trace payload';
    }

    const { method, route, status_code, duration_ms, timestamp, service } = trace;

    if (
        typeof method !== 'string' ||
        !method.trim() ||
        method.trim().length > 10 ||
        /[\x00-\x1F\x7F]/.test(method)
    ) {
        return 'Invalid method';
    }

    if (
        typeof route !== 'string' ||
        !route.trim() ||
        route.trim().length > 255 ||
        /[\x00-\x1F\x7F]/.test(route)
    ) {
        return 'Invalid route';
    }

    if (
        status_code !== undefined &&
        status_code !== null &&
        (!Number.isInteger(status_code) ||
            status_code < 100 ||
            status_code > 599)
    ) {
        return 'Invalid status_code';
    }

    if (
        duration_ms !== undefined &&
        duration_ms !== null &&
        (!Number.isInteger(duration_ms) ||
            duration_ms < 0 ||
            duration_ms > 2147483647)
    ) {
        return 'Invalid duration_ms';
    }

    if (
        timestamp !== undefined &&
        timestamp !== null &&
        (typeof timestamp !== 'string' || Number.isNaN(Date.parse(timestamp)))
    ) {
        return 'Invalid timestamp';
    }

    return validateService(service);
}

// Batched traces are buffered by the client before sending, so they may carry
// the moment the request actually finished. Out-of-window values (stale or
// future clocks) fall back to server time instead of being trusted.
function resolveTraceTimestamp(timestamp, now = Date.now()) {
    if (typeof timestamp !== 'string') {
        return new Date(now).toISOString();
    }

    const parsed = Date.parse(timestamp);

    if (
        Number.isNaN(parsed) ||
        parsed < now - TRACE_MAX_AGE_MS ||
        parsed > now + TRACE_MAX_FUTURE_MS
    ) {
        return new Date(now).toISOString();
    }

    return new Date(parsed).toISOString();
}

router.post('/traces/batch', authenticateAgent, async (req, res) => {
    try {
        const body = req.body;

        if (!body || typeof body !== 'object' || Array.isArray(body) || !Array.isArray(body.traces)) {
            return res.status(400).json({ error: 'traces must be an array' });
        }

        const { traces } = body;

        if (traces.length === 0) {
            return res.status(400).json({ error: 'traces must not be empty' });
        }

        if (traces.length > MAX_TRACE_BATCH_SIZE) {
            return res.status(400).json({
                error: `A batch can contain at most ${MAX_TRACE_BATCH_SIZE} traces`
            });
        }

        const acceptedTraces = [];
        const errors = [];

        for (let i = 0; i < traces.length; i += 1) {
            const problem = validateTraceInput(traces[i]);

            if (problem) {
                errors.push({ index: i, error: problem });
            } else {
                acceptedTraces.push(traces[i]);
            }
        }

        if (acceptedTraces.length > 0) {
            const now = Date.now();
            const methods = [];
            const routes = [];
            const statusCodes = [];
            const durations = [];
            const timestamps = [];
            const services = [];

            for (const trace of acceptedTraces) {
                methods.push(trace.method.trim().toUpperCase());
                routes.push(trace.route.trim());
                statusCodes.push(trace.status_code ?? null);
                durations.push(trace.duration_ms ?? null);
                timestamps.push(resolveTraceTimestamp(trace.timestamp, now));
                services.push(normalizeService(trace.service));
            }

            await pool.query(
                `INSERT INTO traces
                    (host_id, method, route, status_code, duration_ms, timestamp, service)
                 SELECT $1::int, t.method, t.route, t.status_code, t.duration_ms, t.ts, t.service
                 FROM unnest(
                    $2::varchar[],
                    $3::varchar[],
                    $4::int[],
                    $5::int[],
                    $6::timestamptz[],
                    $7::varchar[]
                 ) AS t(method, route, status_code, duration_ms, ts, service)`,
                [
                    req.agentHost.id,
                    methods,
                    routes,
                    statusCodes,
                    durations,
                    timestamps,
                    services
                ]
            );
        }

        return res.status(201).json({
            host_id: req.agentHost.id,
            accepted: acceptedTraces.length,
            rejected: errors.length,
            errors
        });
    } catch (err) {
        console.error('Agent trace batch ingestion error:', err);
        return res.status(500).json({ error: 'Failed to save traces' });
    }
});

module.exports = router;
