const axios = require('axios');

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
 */
function createApmMiddleware(options = {}) {

    const backendUrl = options.backendUrl || process.env.PULSEIQ_BACKEND_URL;
    const apiKey = options.apiKey || process.env.PULSEIQ_API_KEY;

    if (!backendUrl || !apiKey) {
        console.warn('[pulseiq-apm] backendUrl/apiKey not configured — APM reporting disabled');
        return (req, res, next) => next();
    }

    return function apmMiddleware(req, res, next) {

        const startTime = Date.now();

        res.on('finish', () => {

            const duration_ms = Date.now() - startTime;

            // Prefer Express's matched route pattern ("/widgets/:id") over
            // the raw URL ("/widgets/482") — otherwise every unique id or
            // query string fragments into its own "route" and the
            // route-summary aggregation becomes useless.
            const route = (req.route && req.baseUrl + req.route.path) || req.originalUrl;

            // Fire-and-forget: never await, never let APM reporting slow
            // down or break the host application's actual response.
            axios.post(
                `${backendUrl}/api/agent/traces`,
                {
                    method: req.method,
                    route,
                    status_code: res.statusCode,
                    duration_ms
                },
                {
                    headers: { 'X-API-Key': apiKey },
                    timeout: 2000
                }
            ).catch((err) => {
                console.error('[pulseiq-apm] failed to report trace:', err.message);
            });

        });

        next();

    };
}

module.exports = createApmMiddleware;