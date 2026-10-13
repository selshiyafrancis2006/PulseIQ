
const rateLimit = require('express-rate-limit');

const agentRateLimit = rateLimit({
    windowMs: 60 * 1000,
    limit: 120,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: {
        error: 'Too many agent requests. Please retry later.'
    }
});

module.exports = agentRateLimit;
