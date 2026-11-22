require('dotenv').config();

const si = require('systeminformation');
const axios = require('axios');
const { randomUUID } = require('crypto');
const path = require('path');
const { MetricDeliveryQueue } = require('./metric-delivery-queue');
const { createFileStore } = require('./metric-queue-store');
const { toRateKBps } = require('./metric-rates');
const { pickSystemDisk, pickNetworkStats } = require('./metric-selection');
const { version: AGENT_VERSION } = require('./package.json');

const METADATA_INTERVAL_MS = 5 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 10000;
const INGEST_PATH = '/api/agent/metrics';
const DEFAULT_QUEUE_MAX_SIZE = 100;
const NETWORK_WARMUP_MS = 1000;
const SHUTDOWN_FLUSH_MS = 5000;
// The 5-minute rollup only re-reads about the last 2 hours, so a sample that
// is older than this would reach raw data but never the longer-range charts.
const QUEUE_MAX_AGE_MS = 2 * 60 * 60 * 1000;

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
    const queueMaxSize = Number.parseInt(process.env.QUEUE_MAX_SIZE, 10);

    // The queue is saved to a file so samples survive a restart or crash.
    // Set QUEUE_PERSIST=false to keep it in memory only.
    const persistQueue = (process.env.QUEUE_PERSIST || '').trim().toLowerCase() !== 'false';
    const queueFile = path.resolve(
        (process.env.QUEUE_FILE || '').trim() || path.join(__dirname, 'queue.json')
    );

    return {
        metricsUrl,
        apiKey,
        queueFile: persistQueue ? queueFile : null,
        intervalMs: Number.isFinite(interval) && interval >= 1000 ? interval : 5000,
        queueMaxSize: Number.isInteger(queueMaxSize) && queueMaxSize >= 1
            ? queueMaxSize
            : DEFAULT_QUEUE_MAX_SIZE,
        insecureRemote
    };
}

const config = loadConfig();

let lastMetadataSentAt = 0;
let collecting = false;
let shuttingDown = false;
let collectTimer = null;
let monitorRunner = null;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const metricQueue = new MetricDeliveryQueue({
    maxSize: config.queueMaxSize,
    maxAgeMs: QUEUE_MAX_AGE_MS,
    store: config.queueFile ? createFileStore(config.queueFile) : null,
    maxAttempts: Infinity,
    baseDelayMs: 1000,
    maxDelayMs: 8000,
    send: async (payload) => {
        let response;

        try {
            response = await axios.post(
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
        } catch (error) {
            if (error.response?.status === 401) {
                console.error(
                    '[PulseIQ Agent] API key rejected (401) — check that API_KEY matches the key shown when this host was registered'
                );
            }

            throw error;
        }

        if (payload.metadata) {
            lastMetadataSentAt = Date.now();
        }

        console.log(
            `[${new Date().toISOString()}] Delivered metrics — host_id: ${response.data?.host_id ?? 'unknown'}${payload.metadata ? ' (+ metadata)' : ''}`
        );
    }
});

if (metricQueue.restoredCount > 0) {
    console.log(
        `[PulseIQ Agent] Restored ${metricQueue.restoredCount} unsent sample(s) from ${config.queueFile}`
    );

    metricQueue.start();
}

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

// The default-route interface rarely changes, so look it up at most every
// 5 minutes. A failed lookup just means "no preference".
const DEFAULT_IFACE_TTL_MS = 5 * 60 * 1000;
let defaultIface = null;
let defaultIfaceCheckedAt = 0;

async function getDefaultInterface() {
    if (Date.now() - defaultIfaceCheckedAt < DEFAULT_IFACE_TTL_MS) {
        return defaultIface;
    }

    defaultIfaceCheckedAt = Date.now();

    try {
        defaultIface = (await si.networkInterfaceDefault()) || null;
    } catch {
        defaultIface = null;
    }

    return defaultIface;
}

async function collectAndSend() {
    // Avoid overlapping system-information collection.
    // Network delivery runs independently through the queue.
    if (collecting || shuttingDown) return;
    collecting = true;


    try {
        const cpuLoad = await si.currentLoad();
        const mem = await si.mem();
        const disks = await si.fsSize();
        const networkStats = await si.networkStats();
        const preferredIface = await getDefaultInterface();

        const collectedAt = new Date().toISOString();

        const cpu_usage = Number(cpuLoad.currentLoad.toFixed(2));

        const memory_usage = Number(
            ((mem.used / mem.total) * 100).toFixed(2)
        );

        const systemDisk = pickSystemDisk(disks);
        const network = pickNetworkStats(networkStats, preferredIface);

        const disk_usage = systemDisk
            ? Number(Number(systemDisk.use).toFixed(2))
            : 0;

        // toRateKBps turns a missing or negative rate into 0, so a bad
        // network reading can never make the server reject the whole sample.
        const network_in = network ? toRateKBps(network.rx_sec) : 0;
        const network_out = network ? toRateKBps(network.tx_sec) : 0;

        const payload = {
            sample_id: randomUUID(),
            collected_at: collectedAt,
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

        metricQueue.enqueue(payload);

    } catch (err) {
        console.error(
            `[${new Date().toISOString()}] Failed to collect metrics:`,
            err.message
        );
    } finally {
        collecting = false;
    }
}

async function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;

    console.log(
        `[PulseIQ Agent] ${signal} received — stopping and flushing ${metricQueue.size} queued sample(s)`
    );

    clearInterval(collectTimer);

    if (monitorRunner) {
        monitorRunner.stop();
    }

    // Let a collection that is already running finish and enqueue its sample.
    for (let waited = 0; collecting && waited < 2000; waited += 50) {
        await sleep(50);
    }

    const remaining = await metricQueue.flush(SHUTDOWN_FLUSH_MS);

    // With a queue file the unsent samples are kept for the next start.
    const lost = metricQueue.droppedCount + (config.queueFile ? 0 : remaining);

    if (remaining > 0) {
        console.warn(
            config.queueFile
                ? `[PulseIQ Agent] ${remaining} sample(s) could not be delivered before shutdown; they are saved in ${config.queueFile} and will be sent on the next start`
                : `[PulseIQ Agent] ${remaining} sample(s) could not be delivered before shutdown and were discarded`
        );
    }

    console.log(
        `[PulseIQ Agent] Stopped. Samples lost during this run: ${lost}`
    );

    process.exit(0);
}

async function start() {
    console.log(
        `PulseIQ Agent v${AGENT_VERSION} starting — sending to ${config.metricsUrl} every ${config.intervalMs}ms (queue holds up to ${config.queueMaxSize} samples${config.queueFile ? `, saved to ${config.queueFile}` : ', memory only'})`
    );

    if (config.insecureRemote) {
        console.warn(
            'WARNING: BACKEND_URL uses plain http:// to a remote host — your API key and metrics are sent unencrypted. Use https:// in production.'
        );
    }

    // The first networkStats() call has nothing to compare against, so it
    // reports no rate. Take that reading now and wait a moment, so the first
    // real sample carries a measured rate instead of a placeholder 0.
    try {
        await si.networkStats();
        await sleep(NETWORK_WARMUP_MS);
    } catch (err) {
        console.warn(
            `[PulseIQ Agent] Network warm-up failed: ${err.message}`
        );
    }

    if (shuttingDown) return;

    collectAndSend();

    collectTimer = setInterval(collectAndSend, config.intervalMs);

    // G1.4: run the monitor checks that PulseIQ assigned to this host
    // (multi-location monitoring). Set MONITOR_CHECKS=false to turn it off.
    if (process.env.MONITOR_CHECKS !== 'false') {
        const { startMonitorRunner } = require('./monitor-runner');

        monitorRunner = startMonitorRunner({
            baseUrl: config.metricsUrl.replace(/\/api\/agent\/metrics$/, ''),
            apiKey: config.apiKey
        });
    }
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

start();