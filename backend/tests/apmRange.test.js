const {
    DEFAULT_APM_RANGE,
    resolveApmRange
} = require('../src/utils/apmRange');

describe('resolveApmRange', () => {
    test('defaults to one hour when the range is missing', () => {
        expect(DEFAULT_APM_RANGE).toBe('1h');
        expect(resolveApmRange(undefined)).toBe(60);
        expect(resolveApmRange('')).toBe(60);
    });

    test('maps each dashboard range to minutes', () => {
        expect(resolveApmRange('1m')).toBe(1);
        expect(resolveApmRange('15m')).toBe(15);
        expect(resolveApmRange('6h')).toBe(360);
        expect(resolveApmRange('24h')).toBe(1440);
        expect(resolveApmRange('7d')).toBe(10080);
    });

    test('rejects unknown values, including inherited object keys', () => {
        expect(resolveApmRange('2h')).toBeNull();
        expect(resolveApmRange('1 hour')).toBeNull();
        expect(resolveApmRange('constructor')).toBeNull();
        expect(resolveApmRange('__proto__')).toBeNull();
    });
});
