const { createLimiter } = require('./publicRateLimit.middleware');

const metricsQueryLimiter = createLimiter({
    limit: 60,
    keyGenerator: (req) => `metrics-query:${req.user.id}`,
    message: 'Too many metrics queries. Please retry later.'
});

module.exports = metricsQueryLimiter;
