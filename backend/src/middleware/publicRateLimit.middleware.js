const rateLimit = require('express-rate-limit');
const { ipKeyGenerator } = require('express-rate-limit');

const WINDOW_MS = 60 * 1000;

function createLimiter({ limit, keyGenerator, message }) {
    return rateLimit({
        windowMs: WINDOW_MS,
        limit,
        standardHeaders: 'draft-8',
        legacyHeaders: false,
        keyGenerator,
        message: { message }
    });
}

const clientIp = (req) => ipKeyGenerator(req.ip || 'unknown');

// Public status pages need no login, so limit them per client IP. A page
// polls two endpoints every 30 seconds, so 120 per minute leaves plenty of
// room for several viewers behind one office address.
const publicStatusLimiter = createLimiter({
    limit: 120,
    keyGenerator: clientIp,
    message: 'Too many requests. Please retry later.'
});

// Heartbeats are keyed by monitor AND client IP, so someone flooding a
// monitor's URL with bad tokens cannot throttle the real sender (which would
// make the monitor report a false DOWN).
const heartbeatMonitorLimiter = createLimiter({
    limit: 60,
    keyGenerator: (req) => `hb:${req.params.monitorId}:${clientIp(req)}`,
    message: 'Too many heartbeat requests for this monitor. Please retry later.'
});

// Coarse backstop per IP across all monitors, so guessing monitor IDs and
// tokens cannot be spread over many buckets.
const heartbeatIpLimiter = createLimiter({
    limit: 600,
    keyGenerator: clientIp,
    message: 'Too many heartbeat requests. Please retry later.'
});

module.exports = {
    publicStatusLimiter,
    heartbeatLimiters: [heartbeatIpLimiter, heartbeatMonitorLimiter],
    createLimiter
};