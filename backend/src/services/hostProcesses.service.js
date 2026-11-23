const pool = require('../config/db');

// Latest process snapshot of each host, sent by the agent. It is a picture of
// "right now", not a time series, so one row per host is replaced each time.

const MAX_PROCESSES = 50;
const MAX_FUTURE_SKEW_MS = 5 * 60 * 1000;

function toNonNegativeNumber(value, max) {
    const number = Number(value);

    if (value === null || value === '' || !Number.isFinite(number) || number < 0) {
        return null;
    }

    return Math.min(number, max);
}

// Keeps only well-formed entries and trims every field, so a buggy or
// hostile agent cannot store arbitrary data. Returns at most 50 entries.
function sanitizeProcesses(raw) {
    if (!Array.isArray(raw)) return [];

    const seen = new Set();
    const processes = [];

    for (const entry of raw) {
        if (processes.length >= MAX_PROCESSES) break;
        if (!entry || typeof entry !== 'object') continue;

        const pid = Number(entry.pid);
        const name = typeof entry.name === 'string' ? entry.name.trim() : '';
        const cpu = toNonNegativeNumber(entry.cpu, 10000);
        const memoryMb = toNonNegativeNumber(entry.memory_mb, 100000000);

        if (!Number.isSafeInteger(pid) || pid < 0 || !name) continue;
        if (cpu === null || memoryMb === null) continue;
        if (seen.has(pid)) continue;

        seen.add(pid);
        processes.push({
            pid,
            name: name.slice(0, 255),
            cpu: Number(cpu.toFixed(2)),
            memory_mb: Math.round(memoryMb)
        });
    }

    return processes;
}

// Derived here so every client labels a process the same way.
function statusForCpu(cpu) {
    if (cpu > 2) return 'Running';
    if (cpu > 0.3) return 'Idle';

    return 'Sleeping';
}

// A missing, invalid or far-future time falls back to "now", so a wrong agent
// clock can never pin a snapshot in the future and block newer ones.
function resolveCollectedAt(value, now = Date.now()) {
    const time = new Date(value).getTime();

    if (!value || Number.isNaN(time) || time > now + MAX_FUTURE_SKEW_MS) {
        return new Date(now);
    }

    return new Date(time);
}

// An older snapshot (a late retry) never overwrites a newer one.
async function saveHostProcesses(hostId, collectedAt, processes) {
    const result = await pool.query(
        `INSERT INTO host_processes (host_id, collected_at, processes, updated_at)
         VALUES ($1, $2, $3::jsonb, NOW())
         ON CONFLICT (host_id) DO UPDATE
            SET collected_at = EXCLUDED.collected_at,
                processes = EXCLUDED.processes,
                updated_at = NOW()
            WHERE host_processes.collected_at <= EXCLUDED.collected_at
         RETURNING host_id`,
        [hostId, collectedAt, JSON.stringify(processes)]
    );

    return result.rowCount > 0;
}

// Returns null when the host does not exist or belongs to another user.
async function getHostProcesses(hostId, userId) {
    const result = await pool.query(
        `SELECT h.id, hp.collected_at, hp.processes
         FROM hosts h
         LEFT JOIN host_processes hp ON hp.host_id = h.id
         WHERE h.id = $1 AND h.user_id = $2`,
        [hostId, userId]
    );

    if (result.rows.length === 0) return null;

    const row = result.rows[0];
    const stored = Array.isArray(row.processes) ? row.processes : [];

    return {
        host_id: row.id,
        collected_at: row.collected_at,
        processes: stored.map((process) => ({
            pid: process.pid,
            name: process.name,
            cpu: process.cpu,
            memory: process.memory_mb,
            status: statusForCpu(process.cpu)
        }))
    };
}

module.exports = {
    MAX_PROCESSES,
    sanitizeProcesses,
    statusForCpu,
    resolveCollectedAt,
    saveHostProcesses,
    getHostProcesses
};