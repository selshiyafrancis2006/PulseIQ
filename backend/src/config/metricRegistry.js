const METRICS = require('../../../shared/metrics.json');

const BUILT_IN_METRICS = Object.freeze(
    Object.entries(METRICS).map(([name, metric]) =>
        Object.freeze({
            name,
            label: metric.notificationLabel,
            unit: metric.unit,
            isPercentage: metric.unit === '%'
        })
    )
);

const METRIC_NAMES = Object.freeze(
    BUILT_IN_METRICS.map(metric => metric.name)
);

const BY_NAME = new Map(
    BUILT_IN_METRICS.map(metric => [metric.name, metric])
);

const SAFE_NAME = /^[a-z][a-z0-9_]*$/;

for (const name of METRIC_NAMES) {
    if (!SAFE_NAME.test(name)) {
        throw new Error(`Unsafe metric name in registry: ${name}`);
    }
}

const getMetric = name => BY_NAME.get(name) || null;
const isBuiltInMetric = name => BY_NAME.has(name);
const isPercentageMetric = name =>
    Boolean(BY_NAME.get(name)?.isPercentage);

module.exports = {
    BUILT_IN_METRICS,
    METRIC_NAMES,
    getMetric,
    isBuiltInMetric,
    isPercentageMetric
};
