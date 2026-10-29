// G1.4: runs the monitor checks assigned to this agent and reports each
// result to PulseIQ, where the server combines all locations by quorum.
//
// The agent never decides alerts. It only reports UP/DOWN for what it saw.

const net = require('node:net');
const dns = require('node:dns').promises;
const axios = require('axios');

// Mirrors the limits the server uses for its own checks.
const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_TIMEOUT_MS = 30_000;
const MAX_RESPONSE_BYTES = 1_000_000;
const MAX_REDIRECTS = 3;
const TCP_TIMEOUT_MS = 10_000;

const DNS_RESOLVERS = {
    A: 'resolve4',
    AAAA: 'resolve6',
    CNAME: 'resolveCname',
    MX: 'resolveMx',
    TXT: 'resolveTxt',
    NS: 'resolveNs'
};

// Same error_type names the server uses, so results look identical
// wherever the check ran.
function classifyError(error) {
    const code = error?.code;
    const message = String(error?.message || 'Monitor check failed');

    if (
        code === 'ETIMEDOUT' ||
        code === 'ECONNABORTED' ||
        /timeout of \d+ms exceeded/i.test(message)
    ) {
        return { errorType: 'TIMEOUT', errorMessage: 'The monitor check timed out' };
    }

    if (code === 'ENOTFOUND' || code === 'ENODATA' || code === 'EAI_AGAIN') {
        return { errorType: 'DNS', errorMessage: 'The hostname could not be resolved' };
    }

    if (code === 'ECONNREFUSED') {
        return {
            errorType: 'CONNECTION_REFUSED',
            errorMessage: 'The target server refused the connection'
        };
    }

    if (
        code === 'CERT_HAS_EXPIRED' ||
        code === 'DEPTH_ZERO_SELF_SIGNED_CERT' ||
        code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' ||
        code === 'ERR_TLS_CERT_ALTNAME_INVALID' ||
        code === 'EPROTO' ||
        /certificate|tls|ssl|handshake/i.test(message)
    ) {
        return { errorType: 'TLS', errorMessage: 'The secure connection failed' };
    }

    if (/too many redirects|maximum number of redirects/i.test(message)) {
        return {
            errorType: 'TOO_MANY_REDIRECTS',
            errorMessage: 'The monitor exceeded the redirect limit'
        };
    }

    if (
        code === 'ERR_BAD_RESPONSE' ||
        /maxContentLength|maxBodyLength|content length/i.test(message)
    ) {
        return {
            errorType: 'RESPONSE_TOO_LARGE',
            errorMessage: 'The response exceeded the configured size limit'
        };
    }

    return { errorType: 'NETWORK', errorMessage: 'The monitor request failed' };
}

// Pure: same UP/DOWN rules as the server's checkMonitor for HTTP.
function evaluateHttp(monitor, checked) {
    const codes = monitor.expected_status_codes;
    const hasCodes = Array.isArray(codes) && codes.length > 0;

    const statusMatches = hasCodes
        ? codes.includes(checked.statusCode)
        : checked.statusCode >= 200 && checked.statusCode < 400;

    const keyword =
        typeof monitor.expected_keyword === 'string'
            ? monitor.expected_keyword.trim()
            : '';

    const keywordMatches =
        !keyword ||
        String(checked.body ?? '').toLowerCase().includes(keyword.toLowerCase());

    const maxMs = monitor.max_response_time_ms;
    const timeMatches = maxMs == null || checked.responseTimeMs <= maxMs;

    if (statusMatches && keywordMatches && timeMatches) {
        return {
            status: 'UP',
            response_time_ms: checked.responseTimeMs,
            status_code: checked.statusCode,
            error_type: null,
            error_message: null
        };
    }

    const failures = [];

    if (!statusMatches) {
        failures.push(
            hasCodes
                ? `Expected HTTP status ${codes.join(', ')}, received ${checked.statusCode}`
                : `Monitor returned HTTP ${checked.statusCode}`
        );
    }
    if (!keywordMatches) {
        failures.push(`Response body did not contain the expected keyword "${keyword}"`);
    }
    if (!timeMatches) {
        failures.push(`Response time ${checked.responseTimeMs}ms exceeded the ${maxMs}ms limit`);
    }

    return {
        status: 'DOWN',
        response_time_ms: checked.responseTimeMs,
        status_code: checked.statusCode,
        error_type: !statusMatches
            ? 'BAD_STATUS'
            : !keywordMatches
                ? 'UNEXPECTED_BODY'
                : 'SLOW_RESPONSE',
        error_message: failures.join('; ')
    };
}

async function checkHttp(monitor) {
    const timeoutMs = Number(monitor.timeout_ms) || DEFAULT_TIMEOUT_MS;

    if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > MAX_TIMEOUT_MS) {
        throw new Error(`timeout_ms must be between 1 and ${MAX_TIMEOUT_MS}`);
    }

    const startedAt = Date.now();

    const response = await axios.request({
        url: monitor.url,
        method: monitor.method || 'GET',
        headers: monitor.headers || {},
        data: monitor.body ?? undefined,
        timeout: timeoutMs,
        maxRedirects: MAX_REDIRECTS,
        maxContentLength: MAX_RESPONSE_BYTES,
        maxBodyLength: MAX_RESPONSE_BYTES,
        responseType: 'text',
        validateStatus: () => true,
        proxy: false,
        transitional: { clarifyTimeoutError: true }
    });

    return {
        statusCode: response.status,
        responseTimeMs: Date.now() - startedAt,
        body: typeof response.data === 'string'
            ? response.data
            : JSON.stringify(response.data ?? '')
    };
}

function checkTcp(monitor) {
    return new Promise((resolve, reject) => {
        const startedAt = Date.now();
        const socket = net.connect({
            host: monitor.tcp_host,
            port: Number(monitor.tcp_port)
        });

        let settled = false;
        const finish = (error, value) => {
            if (settled) return;
            settled = true;
            socket.destroy();
            if (error) reject(error);
            else resolve(value);
        };

        socket.setTimeout(TCP_TIMEOUT_MS, () => {
            const error = new Error('TCP connection timed out');
            error.code = 'ETIMEDOUT';
            finish(error);
        });
        socket.once('connect', () =>
            finish(null, { responseTimeMs: Date.now() - startedAt })
        );
        socket.once('error', (error) => finish(error));
    });
}

async function checkDns(monitor) {
    const recordType = monitor.dns_record_type || 'A';
    const method = DNS_RESOLVERS[recordType];

    if (!method || !monitor.dns_hostname) {
        throw new Error('Invalid DNS monitor configuration');
    }

    const startedAt = Date.now();
    const records = await dns[method](monitor.dns_hostname);

    if (!Array.isArray(records) || records.length === 0) {
        const error = new Error('The requested DNS record was not found');
        error.code = 'ENODATA';
        throw error;
    }

    return { responseTimeMs: Date.now() - startedAt };
}

// Runs one check and always resolves to a result object, never throws.
async function runCheck(monitor) {
    try {
        if (monitor.monitor_type === 'DNS') {
            const checked = await checkDns(monitor);
            return {
                status: 'UP',
                response_time_ms: checked.responseTimeMs,
                status_code: null,
                error_type: null,
                error_message: null
            };
        }

        if (monitor.monitor_type === 'TCP') {
            const checked = await checkTcp(monitor);
            return {
                status: 'UP',
                response_time_ms: checked.responseTimeMs,
                status_code: null,
                error_type: null,
                error_message: null
            };
        }

        return evaluateHttp(monitor, await checkHttp(monitor));
    } catch (error) {
        const classified = classifyError(error);
        return {
            status: 'DOWN',
            response_time_ms: null,
            status_code: null,
            error_type: classified.errorType,
            error_message: classified.errorMessage
        };
    }
}

function startMonitorRunner({ baseUrl, apiKey, logger = console, options = {} }) {
    const pollEveryMs = options.pollEveryMs ?? 60_000;
    const maxConcurrent = options.maxConcurrent ?? 5;
    const headers = { 'X-API-Key': apiKey, 'Content-Type': 'application/json' };

    // monitorId -> { monitor, nextRunAt }
    const tracked = new Map();
    const inFlight = new Set();
    let active = 0;
    let polling = false;
    let warnedAuth = false;

    async function poll() {
        if (polling) return;
        polling = true;

        try {
            const res = await axios.get(`${baseUrl}/api/agent/monitors`, {
                headers,
                timeout: 10_000
            });

            const monitors = Array.isArray(res.data?.monitors) ? res.data.monitors : [];
            const seen = new Set();
            const now = Date.now();

            for (const monitor of monitors) {
                seen.add(monitor.id);
                const existing = tracked.get(monitor.id);

                if (existing) {
                    existing.monitor = monitor; // pick up config edits
                } else {
                    // Small random delay so a freshly started agent does not
                    // fire every check in the same instant.
                    tracked.set(monitor.id, {
                        monitor,
                        nextRunAt: now + Math.floor(Math.random() * 5000)
                    });
                }
            }

            for (const id of [...tracked.keys()]) {
                if (!seen.has(id)) tracked.delete(id);
            }
        } catch (error) {
            if (error.response?.status === 401) {
                if (!warnedAuth) {
                    logger.error('Monitor runner: API key rejected (401)');
                    warnedAuth = true;
                }
            } else {
                logger.error(
                    'Monitor runner: failed to fetch assigned monitors:',
                    error.response?.data || error.message
                );
            }
        } finally {
            polling = false;
        }
    }

    async function execute(entry) {
        const { monitor } = entry;
        const result = await runCheck(monitor);

        try {
            await axios.post(
                `${baseUrl}/api/agent/monitor-results`,
                { monitor_id: monitor.id, ...result },
                { headers, timeout: 10_000 }
            );
        } catch (error) {
            // A missed vote is acceptable; the next interval sends a new one.
            logger.error(
                `Monitor runner: failed to report result (monitor_id: ${monitor.id}):`,
                error.response?.data || error.message
            );
        }
    }

    function tick() {
        const now = Date.now();

        for (const [id, entry] of tracked) {
            if (active >= maxConcurrent) return;
            if (inFlight.has(id) || now < entry.nextRunAt) continue;

            const intervalSeconds = Number(entry.monitor.interval_seconds);
            const intervalMs =
                Number.isInteger(intervalSeconds) &&
                intervalSeconds >= 30 &&
                intervalSeconds <= 3600
                    ? intervalSeconds * 1000
                    : 30_000;

            inFlight.add(id);
            active += 1;
            entry.nextRunAt = now + intervalMs;

            execute(entry)
                .catch((error) => logger.error('Monitor runner error:', error))
                .finally(() => {
                    inFlight.delete(id);
                    active -= 1;
                });
        }
    }

    void poll();
    const pollTimer = setInterval(() => void poll(), pollEveryMs);
    const tickTimer = setInterval(tick, 1000);

    return {
        stop() {
            clearInterval(pollTimer);
            clearInterval(tickTimer);
        },
        // Exposed for tests.
        _poll: poll,
        _tick: tick,
        _tracked: tracked
    };
}

module.exports = {
    startMonitorRunner,
    runCheck,
    evaluateHttp,
    classifyError
};