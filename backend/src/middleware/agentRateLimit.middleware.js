const rateLimit = require('express-rate-limit');
const { ipKeyGenerator } = require('express-rate-limit');
const { hashApiKey } = require('../utils/apiKey');

const WINDOW_MS = 60 * 1000;
const MAX_API_KEY_LENGTH = 128;

// Coarse backstop per IP. This stops someone from rotating random keys to
// get a fresh per-key bucket on every request.
const ipLimiter = rateLimit({
    windowMs: WINDOW_MS,
    limit: 600,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    keyGenerator: (req) => ipKeyGenerator(req.ip || 'unknown'),
    message: {
        error: 'Too many agent requests. Please retry later.'
    }
});

// The real limit: one bucket per host API key, so many agents behind one
// NAT or office IP no longer throttle each other. The key is hashed so the
// plaintext never sits in the limiter's memory store.
const keyLimiter = rateLimit({
    windowMs: WINDOW_MS,
    limit: 120,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    keyGenerator: (req) => {
        const apiKey = req.headers['x-api-key'];

        if (
            typeof apiKey === 'string' &&
            apiKey.length > 0 &&
            apiKey.length <= MAX_API_KEY_LENGTH
        ) {
            return `key:${hashApiKey(apiKey)}`;
        }

        // Missing or malformed key: fall back to the client IP.
        return `ip:${ipKeyGenerator(req.ip || 'unknown')}`;
    },
    message: {
        error: 'Too many agent requests. Please retry later.'
    }
});

// Express flattens arrays, so app.use('/api/agent', agentRateLimit, ...)
// in app.js works unchanged.
module.exports = [ipLimiter, keyLimiter];