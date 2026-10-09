const isProduction = process.env.NODE_ENV === 'production';

// CORS_ORIGINS is a comma-separated list, e.g.
// CORS_ORIGINS=https://app.example.com,https://www.example.com
const allowedOrigins = (process.env.CORS_ORIGINS || '')
    .split(',')
    .map((origin) => origin.trim().replace(/\/+$/, ''))
    .filter(Boolean);

if (allowedOrigins.length === 0 && isProduction) {
    console.warn(
        '⚠️  CORS_ORIGINS is not set — browsers on other origins will be blocked. ' +
        'Set CORS_ORIGINS to your frontend URL(s), comma-separated.'
    );
}

const corsOptions = {
    origin(origin, callback) {

        // No Origin header: agents, curl, same-origin requests. CORS is a
        // browser rule, and these callers are still protected by JWT / API key.
        if (!origin) return callback(null, true);

        // Nothing configured: open in development, closed in production
        if (allowedOrigins.length === 0) {
            return callback(null, !isProduction);
        }

        return callback(null, allowedOrigins.includes(origin));
    }
};

module.exports = corsOptions;