const {
    BUILT_IN_METRICS,
    METRIC_NAMES,
    getMetric,
    isBuiltInMetric,
    isPercentageMetric
} = require('../src/config/metricRegistry');
const { buildHostMetricEvent } = require('../src/services/hostMetricEvents');

describe('metric registry', () => {
    test('lists the five built-in metrics in a stable order', () => {
        expect(METRIC_NAMES).toEqual([
            'cpu_usage', 'memory_usage', 'disk_usage', 'network_in', 'network_out'
        ]);
    });

    test('is frozen so no module can change it at runtime', () => {
        expect(Object.isFrozen(BUILT_IN_METRICS)).toBe(true);
        expect(Object.isFrozen(METRIC_NAMES)).toBe(true);
        expect(Object.isFrozen(BUILT_IN_METRICS[0])).toBe(true);
    });

    test('every name is safe to interpolate into SQL', () => {
        for (const name of METRIC_NAMES) {
            expect(name).toMatch(/^[a-z][a-z0-9_]*$/);
        }
    });

    test('knows which metrics are percentages', () => {
        expect(isPercentageMetric('cpu_usage')).toBe(true);
        expect(isPercentageMetric('disk_usage')).toBe(true);
        expect(isPercentageMetric('network_in')).toBe(false);
        expect(isPercentageMetric('nope')).toBe(false);
    });

    test('rejects unknown and inherited property names', () => {
        expect(isBuiltInMetric('cpu_usage')).toBe(true);
        expect(isBuiltInMetric('cpu_usage; DROP TABLE metrics')).toBe(false);
        expect(isBuiltInMetric('constructor')).toBe(false);
        expect(isBuiltInMetric('toString')).toBe(false);
        expect(getMetric('nope')).toBeNull();
    });

    test('notification labels come from the registry', () => {
        for (const metric of BUILT_IN_METRICS) {
            const event = buildHostMetricEvent({
                type: 'HOST_METRIC_ALERT',
                host: { id: 1, name: 'h' },
                rule: { metric_name: metric.name, operator: '>', threshold: 1 },
                value: 5,
                severity: 'Warning'
            });
            expect(JSON.stringify(event)).toContain(metric.label);
        }
    });
});
