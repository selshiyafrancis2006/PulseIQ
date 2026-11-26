/**
 * PulseIQ APM middleware — reports per-request timing to PulseIQ.
 *
 * Requests are buffered in memory and sent in batches, so a busy app makes a
 * handful of reporting calls per minute instead of one per request.
 *
 * Usage in any Express app:
 *   const pulseiqApm = require('./apm-middleware');
 *   const apm = pulseiqApm({
 *     backendUrl: 'http://localhost:5000',
 *     apiKey: '<a host's API key, from the Hosts page>',
 *     serviceName: 'checkout-api'
 *   });
 *   app.use(apm);
 *
 *   // Optional: send what is still buffered before the process exits.
 *   process.on('SIGTERM', async () => { await apm.stop(); process.exit(0); });
 *
 * Or via env vars (PULSEIQ_BACKEND_URL / PULSEIQ_API_KEY / PULSEIQ_SERVICE_NAME)
 * with no options.
 *
 * Options:
 *   backendUrl      PulseIQ base URL (trailing slash is fine)
 *   apiKey          the host's API key
 *   serviceName     optional name for this app (max 100 chars). Lets several
 *                   apps on one host be told apart.
 *   flushIntervalMs send buffered traces at least this often (default 5000)
 *   maxBatchSize    send immediately once this many are buffered (default 100, max 500)
 *   maxBufferSize   cap on buffered traces while the backend is unreachable;
 *                   the oldest are dropped first (default 1000)
 *   transport       advanced/testing: async (traces) => void, replaces the HTTP call
 *
 * Routes: a request is reported under Express's matched route pattern
 * ("/api/orders/:id"). Requests that matched no route (404s, scanner traffic,
 * static files) are all reported under the single route "<unmatched>", so
 * random URLs can never fragment the route table.
 *
 * Aborted requests: if the client disconnects before the response finishes,
 * the request is reported with status 499 (the nginx convention).
 *
 * The returned middleware also exposes:
 *   flush()  send everything currently buffered
 *   stop()   stop the timer and flush once more
 *   stats()  { buffered, dropped }
 */

const MAX_BATCH_LIMIT = 500;
const ERROR_LOG_INTERVAL_MS = 30000;

const UNMATCHED_ROUTE = '<unmatched>';
const CLIENT_CLOSED_STATUS = 499;

// These mirror the limits the PulseIQ backend enforces. The backend rejects a
// whole batch if any one trace in it is invalid, so every trace is cleaned
// here to guarantee a single odd request can never cost the other 99.
const MAX_METHOD_LENGTH = 10;
const MAX_ROUTE_LENGTH = 255;
const MAX_SERVICE_LENGTH = 100;
const CONTROL_CHARS = /[\x00-\x1F\x7F]/g;

function positiveInt(value, fallback) {
    const n = Number(value);
    return Number.isInteger(n) && n > 0 ? n : fallback;
}

function cleanText(value, max) {
    return String(value).replace(CONTROL_CHARS, '').trim().slice(0, max);
}

function resolveRoute(req) {
    const path = req.route && req.route.path;

    // No matched route, or a pattern that is not a plain string (regex or
    // array of paths): report one stable label instead of the raw URL.
    if (typeof path !== 'string') {
        return UNMATCHED_ROUTE;
    }

    return cleanText(`${req.baseUrl || ''}${path}`, MAX_ROUTE_LENGTH) || UNMATCHED_ROUTE;
}

function resolveStatus(statusCode) {
    return Number.isInteger(statusCode) && statusCode >= 100 && statusCode <= 599
        ? statusCode
        : null;
}

function createHttpTransport(baseUrl, apiKey) {
    // Loaded lazily so tests (and apps that inject their own transport)
    // do not need axios.
    const axios = require('axios');

    return (traces) =>
        axios.post(
            `${baseUrl}/api/agent/traces/batch`,
            { traces },
            {
                headers: { 'X-API-Key': apiKey },
                timeout: 5000
            }
        );
}

// A 4xx (other than "slow down") means this exact batch will never be
// accepted, so retrying it would just block everything behind it.
function isPermanentFailure(err) {
    const status = err && err.response && err.response.status;

    return (
        typeof status === 'number' &&
        status >= 400 &&
        status < 500 &&
        status !== 408 &&
        status !== 429
    );
}

function createApmMiddleware(options = {}) {

    const rawBackendUrl = options.backendUrl || process.env.PULSEIQ_BACKEND_URL;
    const apiKey = options.apiKey || process.env.PULSEIQ_API_KEY;

    if (!rawBackendUrl || !apiKey) {
        console.warn('[pulseiq-apm] backendUrl/apiKey not configured — APM reporting disabled');

        const disabled = (req, res, next) => next();
        disabled.flush = async () => {};
        disabled.stop = async () => {};
        disabled.stats = () => ({ buffered: 0, dropped: 0 });

        return disabled;
    }

    const backendUrl = String(rawBackendUrl).replace(/\/+$/, '');
    const service =
        cleanText(options.serviceName || process.env.PULSEIQ_SERVICE_NAME || '', MAX_SERVICE_LENGTH) || null;
    const flushIntervalMs = positiveInt(options.flushIntervalMs, 5000);
    const maxBatchSize = Math.min(positiveInt(options.maxBatchSize, 100), MAX_BATCH_LIMIT);
    const maxBufferSize = Math.max(positiveInt(options.maxBufferSize, 1000), maxBatchSize);
    const transport = options.transport || createHttpTransport(backendUrl, apiKey);

    let buffer = [];
    let flushing = false;
    let dropped = 0;
    let lastErrorLogAt = 0;

    function logError(message) {
        const now = Date.now();

        // One line per 30s is plenty; an outage must not flood the host app's logs.
        if (now - lastErrorLogAt >= ERROR_LOG_INTERVAL_MS) {
            lastErrorLogAt = now;
            console.error(`[pulseiq-apm] ${message}`);
        }
    }

    function trimBuffer() {
        if (buffer.length > maxBufferSize) {
            const overflow = buffer.length - maxBufferSize;
            buffer.splice(0, overflow);
            dropped += overflow;
        }
    }

    async function flush() {

        if (flushing) {
            return;
        }

        flushing = true;

        try {

            while (buffer.length > 0) {

                const batch = buffer.splice(0, maxBatchSize);

                try {

                    await transport(batch);

                } catch (err) {

                    if (isPermanentFailure(err)) {
                        dropped += batch.length;
                        logError(`backend rejected a batch of ${batch.length} traces (${err.response.status}) — dropped`);
                        continue;
                    }

                    // Transient (network down, timeout, 429, 5xx): keep the
                    // batch for the next flush, still respecting the cap.
                    buffer = batch.concat(buffer);
                    trimBuffer();
                    logError(`failed to report traces, will retry: ${err && err.message}`);
                    break;
                }
            }

        } finally {
            flushing = false;
        }
    }

    function enqueue(trace) {
        buffer.push(trace);
        trimBuffer();

        if (buffer.length >= maxBatchSize) {
            flush();
        }
    }

    const timer = setInterval(() => {
        flush();
    }, flushIntervalMs);

    // Never keep the host app's process alive just to report timings.
    if (typeof timer.unref === 'function') {
        timer.unref();
    }

    function apmMiddleware(req, res, next) {

        const startTime = Date.now();
        let recorded = false;

        const record = (aborted) => {

            // 'close' also fires after a normal 'finish'; report each request once.
            if (recorded) {
                return;
            }

            recorded = true;

            try {

                const trace = {
                    method: cleanText(req.method || '', MAX_METHOD_LENGTH).toUpperCase() || 'UNKNOWN',
                    route: resolveRoute(req),
                    status_code: aborted ? CLIENT_CLOSED_STATUS : resolveStatus(res.statusCode),
                    duration_ms: Math.max(0, Math.round(Date.now() - startTime)),
                    timestamp: new Date().toISOString()
                };

                if (service) {
                    trace.service = service;
                }

                enqueue(trace);

            } catch (err) {
                // Reporting must never affect the host application.
            }
        };

        res.on('finish', () => record(false));
        res.on('close', () => record(true));

        next();

    }

    apmMiddleware.flush = flush;

    apmMiddleware.stop = async () => {
        clearInterval(timer);
        await flush();
    };

    apmMiddleware.stats = () => ({ buffered: buffer.length, dropped });

    return apmMiddleware;
}

module.exports = createApmMiddleware;