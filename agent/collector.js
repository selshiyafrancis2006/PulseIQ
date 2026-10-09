require('dotenv').config();

const si = require('systeminformation');
const axios = require('axios');
const { version: AGENT_VERSION } = require('./package.json');

const METADATA_INTERVAL_MS = 5 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 10000;
const INGEST_PATH = '/api/agent/metrics';

function isLocalOrInternalHost(hostname) {
    return (
        hostname === 'localhost' ||
        hostname === '127.0.0.1' ||
        hostname === '[::1]' ||
        !hostname.includes('.')
    );
}

function loadConfig() {

    const rawUrl = (process.env.BACKEND_URL || '').trim();
    const apiKey = (process.env.API_KEY || '').trim();
    const problems = [];

    if (!rawUrl) {
        problems.push('BACKEND_URL is not set (example: https://pulseiq.example.com)');
    }

    if (!apiKey) {
        problems.push('API_KEY is not set (it is shown once when you register the host in PulseIQ)');
    }

    let metricsUrl = null;
    let insecureRemote = false;

    if (rawUrl) {
        try {
            const parsed = new URL(rawUrl);

            if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
                throw new Error('unsupported protocol');
            }

            // Accept either a base URL or the full ingest URL
            const basePath = parsed.pathname
                .replace(/\/+$/, '')
                .replace(/\/api\/agent\/metrics$/, '');

            metricsUrl = `${parsed.origin}${basePath}${INGEST_PATH}`;

            insecureRemote =
                parsed.protocol === 'http:' &&
                !isLocalOrInternalHost(parsed.hostname);
        } catch {
            problems.push(`BACKEND_URL is not a valid http(s) URL: "${rawUrl}"`);
        }
    }

    if (problems.length > 0) {
        console.error('PulseIQ Agent cannot start:');
        problems.forEach((problem) => console.error(`  - ${problem}`));
        process.exit(1);
    }

    const interval = Number(process.env.INTERVAL_MS);

    return {
        metricsUrl,
        apiKey,
        intervalMs: Number.isFinite(interval) && interval >= 1000 ? interval : 5000,
        insecureRemote
    };
}

const config = loadConfig();

let lastMetadataSentAt = 0;
let sending = false;

async function collectMetadata() {

    try {

        const [osInfo, cpu, mem, interfaces, time] = await Promise.all([
            si.osInfo(),
            si.cpu(),
            si.mem(),
            si.networkInterfaces(),
            si.time()
        ]);

        const ifaceList = Array.isArray(interfaces) ? interfaces : [interfaces];

        const primary =
            ifaceList.find((i) => i.default && i.ip4) ||
            ifaceList.find((i) => !i.internal && i.ip4);

        return {
            hostname: osInfo.hostname,
            os: [osInfo.distro, osInfo.release].filter(Boolean).join(' '),
            platform: osInfo.platform,
            arch: osInfo.arch,
            cpu_model: [cpu.manufacturer, cpu.brand].filter(Boolean).join(' '),
            cpu_cores: cpu.cores,
            total_memory_mb: Math.round(mem.total / 1024 / 1024),
            ip_address: primary ? primary.ip4 : null,
            agent_version: AGENT_VERSION,
            boot_time: new Date(Date.now() - time.uptime * 1000).toISOString()
        };

    } catch (err) {

        console.error(
            `[${new Date().toISOString()}] Failed to collect host metadata:`,
            err.message
        );

        return null;

    }

}

async function collectAndSend() {

    // Skip this tick if the previous send is still in flight
    if (sending) return;
    sending = true;

    try {

        const cpuLoad = await si.currentLoad();
        const mem = await si.mem();
        const disk = await si.fsSize();
        const network = await si.networkStats();

        const cpu_usage = Number(cpuLoad.currentLoad.toFixed(2));

        const memory_usage = Number(
            ((mem.used / mem.total) * 100).toFixed(2)
        );

        const disk_usage = disk.length > 0
            ? Number(disk[0].use.toFixed(2))
            : 0;

        const network_in = network.length > 0
            ? Number((network[0].rx_sec / 1024).toFixed(2))
            : 0;

        const network_out = network.length > 0
            ? Number((network[0].tx_sec / 1024).toFixed(2))
            : 0;

        const payload = {
            cpu_usage,
            memory_usage,
            disk_usage,
            network_in,
            network_out
        };

        const metadataDue =
            Date.now() - lastMetadataSentAt >= METADATA_INTERVAL_MS;

        if (metadataDue) {
            const metadata = await collectMetadata();
            if (metadata) {
                payload.metadata = metadata;
            }
        }

        const response = await axios.post(
            config.metricsUrl,
            payload,
            {
                headers: {
                    'X-API-Key': config.apiKey,
                    'Content-Type': 'application/json'
                },
                timeout: REQUEST_TIMEOUT_MS
            }
        );

        if (payload.metadata) {
            lastMetadataSentAt = Date.now();
        }

        console.log(
            `[${new Date().toISOString()}] Sent metrics — host_id: ${response.data.host_id}${payload.metadata ? ' (+ metadata)' : ''}`
        );

    } catch (err) {

        if (err.response?.status === 401) {
            console.error(
                `[${new Date().toISOString()}] API key rejected (401) — check that API_KEY matches the key shown when this host was registered`
            );
        } else {
            console.error(
                `[${new Date().toISOString()}] Failed to send metrics:`,
                err.response?.data || err.message
            );
        }

    } finally {

        sending = false;

    }

}

console.log(
    `PulseIQ Agent v${AGENT_VERSION} starting — sending to ${config.metricsUrl} every ${config.intervalMs}ms`
);

if (config.insecureRemote) {
    console.warn(
        'WARNING: BACKEND_URL uses plain http:// to a remote host — your API key and metrics are sent unencrypted. Use https:// in production.'
    );
}

collectAndSend();

setInterval(collectAndSend, config.intervalMs);