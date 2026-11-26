jest.mock('../src/config/db', () => ({
    connect: jest.fn(),
    query: jest.fn()
}));

const { getAlertSeverity } = require('../src/services/alert.service');

describe('getAlertSeverity for APM metrics', () => {
    test('error rate is Warning below 25% and Critical from 25%', () => {
        expect(getAlertSeverity('apm_error_rate', 6)).toBe('Warning');
        expect(getAlertSeverity('apm_error_rate', 24.9)).toBe('Warning');
        expect(getAlertSeverity('apm_error_rate', 25)).toBe('Critical');
    });

    test('p95 latency is Warning below 5000ms and Critical from 5000ms', () => {
        expect(getAlertSeverity('apm_p95_ms', 1200)).toBe('Warning');
        expect(getAlertSeverity('apm_p95_ms', 4999)).toBe('Warning');
        expect(getAlertSeverity('apm_p95_ms', 5000)).toBe('Critical');
    });

    test('existing host metrics keep their severity', () => {
        expect(getAlertSeverity('cpu_usage', 95)).toBe('Critical');
        expect(getAlertSeverity('cpu_usage', 80)).toBe('Warning');
        expect(getAlertSeverity('network_in', 99999)).toBe('Warning');
    });
});
