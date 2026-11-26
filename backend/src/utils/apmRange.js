// Time ranges the APM read API accepts, and the bucket width used when a
// range is drawn as a time series. Widths keep every chart at 30-170 points.
const APM_RANGES = {
    '15m': { seconds: 15 * 60, bucketSeconds: 30 },
    '1h': { seconds: 60 * 60, bucketSeconds: 60 },
    '6h': { seconds: 6 * 60 * 60, bucketSeconds: 5 * 60 },
    '24h': { seconds: 24 * 60 * 60, bucketSeconds: 15 * 60 },
    '7d': { seconds: 7 * 24 * 60 * 60, bucketSeconds: 60 * 60 }
};

const DEFAULT_APM_RANGE = '1h';

// Returns the range config for a query value, or null when it is not one we
// offer. An absent value falls back to the default.
function resolveApmRange(value) {
    if (value === undefined || value === null || value === '') {
        return { key: DEFAULT_APM_RANGE, ...APM_RANGES[DEFAULT_APM_RANGE] };
    }

    if (typeof value !== 'string' || !Object.hasOwn(APM_RANGES, value)) {
        return null;
    }

    return { key: value, ...APM_RANGES[value] };
}

module.exports = { APM_RANGES, DEFAULT_APM_RANGE, resolveApmRange };