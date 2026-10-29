const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const authenticateAgent = require('../middleware/agentAuth.middleware');
const { evaluateAlerts } = require('../services/alert.service');
const { detectAnomalies } = require('../services/baseline.service');
const { broadcastMetrics } = require('../services/websocket.service');

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
            network_out
        } = req.body;

                const metricValues = {
            cpu_usage,
            memory_usage,
            disk_usage,
            network_in,
            network_out
        };

        for (const [key, value] of Object.entries(metricValues)) {
            if (
                typeof value !== 'number' ||
                !Number.isFinite(value) ||
                value < 0 ||
                (['cpu_usage', 'memory_usage', 'disk_usage'].includes(key) && value > 100)
            ) {
                return res.status(400).json({
                    error: `Invalid metric value: ${key}`
                });
            }
        }
        
        const result = await pool.query(
            `INSERT INTO metrics (
                cpu_usage,
                memory_usage,
                disk_usage,
                network_in,
                network_out,
                host_id
            )
            VALUES ($1, $2, $3, $4, $5, $6)
            RETURNING *`,
            [
                cpu_usage,
                memory_usage,
                disk_usage,
                network_in,
                network_out,
                req.agentHost.id
            ]
        );
        const savedMetric = result.rows[0];

        await pool.query(
    'UPDATE hosts SET last_seen_at = NOW() WHERE id = $1',
    [req.agentHost.id]
);
        // Host metadata is optional and must never break metric ingestion
        const metadata = sanitizeMetadata(req.body.metadata);
        if (metadata) {
            try {
                await saveHostMetadata(req.agentHost.id, metadata);
            } catch (metaErr) {
                console.error('Failed to save host metadata:', metaErr);
            }
        }

               // The metric is already saved. Alerting, anomaly detection and the
        // live broadcast are side effects: a failure in one must not make
        // the agent think ingestion failed, nor skip the others.
        const sideEffects = [
            ['evaluateAlerts', () => evaluateAlerts(savedMetric)],
            ['detectAnomalies', () => detectAnomalies(savedMetric)],
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

router.post('/traces', authenticateAgent, async (req, res) => {
    try {
        const body = req.body;

        if (!body || typeof body !== 'object' || Array.isArray(body)) {
            return res.status(400).json({ error: 'Invalid trace payload' });
        }

        const { method, route, status_code, duration_ms } = body;

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

        const result = await pool.query(
            `INSERT INTO traces
                (host_id, method, route, status_code, duration_ms)
             VALUES ($1, $2, $3, $4, $5)
             RETURNING *`,
            [
                req.agentHost.id,
                method.trim().toUpperCase(),
                route.trim(),
                status_code ?? null,
                duration_ms ?? null
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

module.exports = router;