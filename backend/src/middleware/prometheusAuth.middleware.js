const crypto = require('crypto');

const hashToken = (token) => {
    return crypto.createHash('sha256').update(token, 'utf8').digest();
};

const authenticatePrometheus = (req, res, next) => {
    const configuredToken = process.env.PROMETHEUS_METRICS_TOKEN;

    if (
        typeof configuredToken !== 'string' ||
        configuredToken.length === 0
    ) {
        return res.status(503).json({
            error: 'Prometheus metrics endpoint is not configured'
        });
    }

    const authorization = req.get('authorization') || '';
    const match = /^Bearer\s+(\S+)$/i.exec(authorization);
    const suppliedToken = match ? match[1] : '';

    const expectedDigest = hashToken(configuredToken);
    const suppliedDigest = hashToken(suppliedToken);

    const isValid =
        Boolean(match) &&
        crypto.timingSafeEqual(expectedDigest, suppliedDigest);

    if (!isValid) {
        return res.status(401).json({
            error: 'Unauthorized'
        });
    }

    return next();
};

module.exports = authenticatePrometheus;
