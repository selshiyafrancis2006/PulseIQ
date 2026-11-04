jest.mock('../../src/config/db', () => ({
    query: jest.fn()
}));

const ENV_KEYS = [
    'METRICS_RAW_RETENTION_DAYS',
    'METRICS_ROLLUP_5M_RETENTION_DAYS',
    'METRICS_ROLLUP_1H_RETENTION_DAYS',
    'ANOMALY_RETENTION_DAYS',
    'TRACE_RETENTION_DAYS',
    'MONITOR_RESULTS_RETENTION_DAYS',
    'MONITOR_ROLLUP_RETENTION_DAYS'
];

const originalEnv = {};

beforeAll(() => {
    for (const key of ENV_KEYS) {
        originalEnv[key] = process.env[key];
    }
});

afterAll(() => {
    for (const key of ENV_KEYS) {
        if (originalEnv[key] === undefined) {
            delete process.env[key];
        } else {
            process.env[key] = originalEnv[key];
        }
    }

    jest.resetModules();
});

function loadRetentionServices() {
    jest.resetModules();

    const metrics = require('../../src/services/metricRollup.service');
    const monitors = require('../../src/services/monitorRollup.service');

    return { metrics, monitors };
}

function clearRetentionEnvironment() {
    for (const key of ENV_KEYS) {
        delete process.env[key];
    }
}

describe('retention environment configuration', () => {
    beforeEach(() => {
        clearRetentionEnvironment();
    });

    test('uses documented defaults when environment variables are unset', () => {
        const { metrics, monitors } = loadRetentionServices();

        expect({
            raw: metrics.RAW_RETENTION_DAYS,
            fiveMinute: metrics.ROLLUP_5M_RETENTION_DAYS,
            hourly: metrics.ROLLUP_1H_RETENTION_DAYS,
            anomalies: metrics.ANOMALY_RETENTION_DAYS,
            traces: metrics.TRACE_RETENTION_DAYS,
            monitorResults: monitors.RAW_RETENTION_DAYS,
            monitorRollups: monitors.ROLLUP_RETENTION_DAYS
        }).toEqual({
            raw: 3,
            fiveMinute: 8,
            hourly: 90,
            anomalies: 30,
            traces: 7,
            monitorResults: 35,
            monitorRollups: 400
        });
    });

    test('uses valid custom environment values', () => {
        Object.assign(process.env, {
            METRICS_RAW_RETENTION_DAYS: '5',
            METRICS_ROLLUP_5M_RETENTION_DAYS: '10',
            METRICS_ROLLUP_1H_RETENTION_DAYS: '120',
            ANOMALY_RETENTION_DAYS: '45',
            TRACE_RETENTION_DAYS: '14',
            MONITOR_RESULTS_RETENTION_DAYS: '40',
            MONITOR_ROLLUP_RETENTION_DAYS: '500'
        });

        const { metrics, monitors } = loadRetentionServices();

        expect({
            raw: metrics.RAW_RETENTION_DAYS,
            fiveMinute: metrics.ROLLUP_5M_RETENTION_DAYS,
            hourly: metrics.ROLLUP_1H_RETENTION_DAYS,
            anomalies: metrics.ANOMALY_RETENTION_DAYS,
            traces: metrics.TRACE_RETENTION_DAYS,
            monitorResults: monitors.RAW_RETENTION_DAYS,
            monitorRollups: monitors.ROLLUP_RETENTION_DAYS
        }).toEqual({
            raw: 5,
            fiveMinute: 10,
            hourly: 120,
            anomalies: 45,
            traces: 14,
            monitorResults: 40,
            monitorRollups: 500
        });
    });

    test('falls back to defaults when values are invalid or below minimums', () => {
        Object.assign(process.env, {
            METRICS_RAW_RETENTION_DAYS: 'invalid',
            METRICS_ROLLUP_5M_RETENTION_DAYS: '7',
            METRICS_ROLLUP_1H_RETENTION_DAYS: '89',
            ANOMALY_RETENTION_DAYS: '0',
            TRACE_RETENTION_DAYS: 'invalid',
            MONITOR_RESULTS_RETENTION_DAYS: '30',
            MONITOR_ROLLUP_RETENTION_DAYS: '30'
        });

        const { metrics, monitors } = loadRetentionServices();

        expect({
            raw: metrics.RAW_RETENTION_DAYS,
            fiveMinute: metrics.ROLLUP_5M_RETENTION_DAYS,
            hourly: metrics.ROLLUP_1H_RETENTION_DAYS,
            anomalies: metrics.ANOMALY_RETENTION_DAYS,
            traces: metrics.TRACE_RETENTION_DAYS,
            monitorResults: monitors.RAW_RETENTION_DAYS,
            monitorRollups: monitors.ROLLUP_RETENTION_DAYS
        }).toEqual({
            raw: 3,
            fiveMinute: 8,
            hourly: 90,
            anomalies: 30,
            traces: 7,
            monitorResults: 35,
            monitorRollups: 400
        });
    });
});