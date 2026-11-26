const axios = require('axios');
const { ApmReporter } = require('./apm-reporter');

const MAX_ROUTE_LENGTH = 255;
const MAX_METHOD_LENGTH = 10;
const UNMATCHED_ROUTE = 'UNMATCHED';

// nginx's convention for "client closed the connection before we answered".
const CLIENT_CLOSED_STATUS = 499;

/**
 * PulseIQ APM middleware — reports per-request timing to PulseIQ.
 *
 * Usage in any Express app:
 *   const pulseiqApm = require('./apm-middleware');
 *   app.use(pulseiqApm({
 *     backendUrl: 'http://localhost:5001',
 *     apiKey: '<a host's API key, from the Hosts page>'
 *   }));
 *
 * Or via env vars (PULSEIQ_BACKEND_URL / PULSEIQ_API_KEY) with no options.
 *
 * How it behaves:
 *  - Requests are buffered and sent in batches (POST /api/agent/traces/batch)
 *    every few seconds, never one HTTP call per request.
 *  - Delivery backs off on 429 / 5xx / network errors and never blocks or
 *    breaks the host app. If the buffer fills up the oldest traces are dropped.
 *  - Aborted requests (client disconnected) are recorded with status 499.
 *  - Routes are the Express route pattern ("/widgets/:id"). Requests that
 *    matched no route are grouped as "UNMATCHED"; query strings are never sent.
 *  - Pending traces are flushed on process exit / SIGTERM. If your app has its
 *    own shutdown logic, call `await apm.shutdown()` there instead.
 *
 * Options (all optional except backendUrl / apiKey):
 *   sampleRate       0..1, fraction of ordinary requests to keep (default 1).
 *                    Errors (status >= 400), aborted and slow requests are
 *                    always kept. Note: with sampleRate < 1 request counts
 *                    in the dashboard are undercounted.
 *   slowThresholdMs  requests at least this slow are always kept (default 1000)
 *   flushIntervalMs  how often buffered traces are sent (default 5000)
 *   maxBatchSize     traces per request, max 500 (default 200)
 *   maxBufferSize    traces held in memory before dropping oldest (default 1000)
 *   timeoutMs        HTTP timeout per delivery (default 2000)
 *   routeResolver    (req) => string, for apps that do not use Express routing
 *   flushOnExit      flush on exit/SIGTERM (default true)
 *   logger           object with warn(), default console
 */

// Express exposes the matched pattern as req.route.path (+ req.baseUrl for
// mounted routers). Anything else is "UNMATCHED" — never the raw URL, which
// would put every id, 404 probe and query string into its own "route".
function resolveRoute(req) {
    const path = req.route && req.route.path;

    if (path === undefined || path === null) {
        return UNMATCHED_ROUTE;
    }

    if (typeof path !== 'string') {
        return UNMATCHED_ROUTE;
    }

    return (req.baseUrl || '') + path;
}

// Strip query string / fragment and control characters, then truncate (the
// backend rejects routes over 255 chars, so truncate instead of losing the
// trace).
function cleanRoute(route) {
    if (typeof route !== 'string') return UNMATCHED_ROUTE;

    const cleaned = route
        .split(/[?#]/)[0]
        .replace(/[\x00-\x1F\x7F]/g, '')
        .trim()
        .slice(0, MAX_ROUTE_LENGTH);

    return cleaned || UNMATCHED_ROUTE;
}

function cleanMethod(method) {
    const cleaned = String(method || 'GET')
        .replace(/[\x00-\x1F\x7F]/g, '')
        .trim()
        .toUpperCase()
        .slice(0, MAX_METHOD_LENGTH);

    return cleaned || 'GET';
}

function normalizeStatus(status) {
    return Number.isInteger(status) && status >= 100 && status <= 599
        ? status
        : null;
}

function parseSampleRate(value) {
    if (value === undefined || value === null || value === '') return 1;

    const rate = Number(value);

    return Number.isFinite(rate) && rate >= 0 && rate <= 1 ? rate : null;
}

// Errors, aborted and slow requests are always kept; the rest are sampled.
function shouldKeep({ statusCode, durationMs, aborted }, config, random) {
    if (aborted || statusCode >= 400) return true;
    if (durationMs >= config.slowThresholdMs) return true;
    if (config.sampleRate >= 1) return true;
    if (config.sampleRate <= 0) return false;

    return random() < config.sampleRate;
}

function installExitHooks(reporter) {
    // 'beforeExit' fires when the event loop drains naturally. The reporter's
    // timer is unref'd, so without this a short-lived process would exit with
    // traces still buffered.
    process.once('beforeExit', () => {
        reporter.flush({ force: true }).catch(() => {});
    });

    // Registering a SIGTERM listener removes Node's default "exit on SIGTERM",
    // so after flushing we put the default back — unless the host app has its
    // own SIGTERM handler, in which case it owns the shutdown.
    if (process.listenerCount('SIGTERM') === 0) {
        const onSigterm = () => {
            reporter
                .shutdown()
                .catch(() => {})
                .finally(() => {
                    process.removeListener('SIGTERM', onSigterm);

                    if (process.listenerCount('SIGTERM') === 0) {
                        process.kill(process.pid, 'SIGTERM');
                    }
                });
        };

        process.on('SIGTERM', onSigterm);
    }
}

function createApmMiddleware(options = {}) {

    const backendUrl = options.backendUrl || process.env.PULSEIQ_BACKEND_URL;
    const apiKey = options.apiKey || process.env.PULSEIQ_API_KEY;
    const logger = options.logger || console;

    if (!backendUrl || !apiKey) {
        logger.warn('[pulseiq-apm] backendUrl/apiKey not configured — APM reporting disabled');

        const passthrough = (req, res, next) => next();
        passthrough.flush = async () => {};
        passthrough.shutdown = async () => {};
        passthrough.stop = passthrough.shutdown;
        passthrough.stats = () => ({ buffered: 0, dropped: 0 });

        return passthrough;
    }

    const sampleRate = parseSampleRate(
        options.sampleRate !== undefined
            ? options.sampleRate
            : process.env.PULSEIQ_APM_SAMPLE_RATE
    );

    if (sampleRate === null) {
        logger.warn('[pulseiq-apm] sampleRate must be a number between 0 and 1 — using 1');
    }

    const config = {
        sampleRate: sampleRate === null ? 1 : sampleRate,
        slowThresholdMs: Number.isFinite(options.slowThresholdMs)
            ? options.slowThresholdMs
            : 1000
    };

    const random = options.random || Math.random;
    const resolver = typeof options.routeResolver === 'function'
        ? options.routeResolver
        : resolveRoute;

    const endpoint = `${backendUrl.replace(/\/+$/, '')}/api/agent/traces/batch`;
    const timeout = Number.isInteger(options.timeoutMs) ? options.timeoutMs : 2000;

    const send = options.transport || options.send || (async (traces) => {
        const response = await axios.post(
            endpoint,
            { traces },
            { headers: { 'X-API-Key': apiKey }, timeout }
        );

        return response.data;
    });

    const service = String(options.serviceName || process.env.PULSEIQ_SERVICE_NAME || '')
        .replace(/[\x00-\x1F\x7F]/g, '')
        .trim()
        .slice(0, 100);

    const reporter = new ApmReporter({
        send,
        logger,
        flushIntervalMs: options.flushIntervalMs,
        maxBatchSize: Math.min(options.maxBatchSize || 100, 500),
        flushOnBatch: true,
        maxBufferSize: options.maxBufferSize,
        maxBatchesPerFlush: options.maxBatchesPerFlush
    });

    if (options.flushOnExit !== false) {
        installExitHooks(reporter);
    }

    function apmMiddleware(req, res, next) {

        const startedAt = new Date().toISOString();
        const start = process.hrtime.bigint();
        let recorded = false;

        // Runs once per request: on 'finish' for normal responses, on 'close'
        // when the client went away before the response completed.
        const record = (aborted) => {

            if (recorded) return;
            recorded = true;

            try {
                const durationMs = Math.round(
                    Number(process.hrtime.bigint() - start) / 1e6
                );

                const statusCode = aborted ? CLIENT_CLOSED_STATUS : normalizeStatus(res.statusCode);

                if (!shouldKeep({ statusCode, durationMs, aborted }, config, random)) {
                    return;
                }

                reporter.add({
                    method: cleanMethod(req.method),
                    route: cleanRoute(resolver(req)),
                    status_code: statusCode,
                    duration_ms: durationMs,
                    timestamp: startedAt,
                    ...(service ? { service } : {})
                });
            } catch (err) {
                // Instrumentation must never take the host app down.
                reporter.warn('record-failed', `failed to record trace: ${err.message}`);
            }
        };

        res.on('finish', () => record(false));
        res.on('close', () => record(!res.writableFinished));

        next();

    }

    apmMiddleware.flush = () => reporter.flush({ force: true });
    apmMiddleware.shutdown = (timeoutMs) => reporter.shutdown(timeoutMs);
    apmMiddleware.stop = apmMiddleware.shutdown;
    apmMiddleware.stats = () => ({
        buffered: reporter.size,
        dropped: reporter.stats.dropped
    });
    apmMiddleware.reporter = reporter;

    return apmMiddleware;
}

module.exports = createApmMiddleware;
module.exports.createApmMiddleware = createApmMiddleware;
module.exports.resolveRoute = resolveRoute;
module.exports.cleanRoute = cleanRoute;
module.exports.shouldKeep = shouldKeep;
