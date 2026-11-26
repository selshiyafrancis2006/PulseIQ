jest.mock('../src/config/db', () => ({
    connect: jest.fn(),
    query: jest.fn()
}));

jest.mock('../src/services/alert.service', () => ({
    evaluateAlerts: jest.fn()
}));

const pool = require('../src/config/db');
const { evaluateAlerts } = require('../src/services/alert.service');

const {
    APM_ALERT_METRICS,
    getApmAlertConfig,
    buildApmMetric,
    runApmAlertCheck
} = require('../src/services/apmAlert.service');

describe('apmAlert.service', () => {
    const originalEnv = { ...process.env };

    beforeEach(() => {
        jest.clearAllMocks();
        delete process.env.APM_ALERT_WINDOW_MINUTES;
        delete process.env.APM_ALERT_MIN_REQUESTS;
        evaluateAlerts.mockResolvedValue(undefined);
        pool.query.mockResolvedValue({ rows: [] });
    });

    afterAll(() => {
        process.env = originalEnv;
    });

    describe('getApmAlertConfig', () => {
        test('defaults to a 5 minute window and 20 request minimum', () => {
            expect(getApmAlertConfig()).toEqual({
                windowMinutes: 5,
                minRequests: 20
            });
        });

        test('reads valid overrides and ignores invalid ones', () => {
            process.env.APM_ALERT_WINDOW_MINUTES = '10';
            process.env.APM_ALERT_MIN_REQUESTS = 'abc';

            expect(getApmAlertConfig()).toEqual({
                windowMinutes: 10,
                minRequests: 20
            });
        });
    });

    describe('buildApmMetric', () => {
        test('computes a 5xx-based error rate and rounds p95', () => {
            expect(buildApmMetric({
                host_id: 7,
                request_count: 200,
                error_count: 9,
                p95_ms: 1234.5678
            })).toEqual({
                host_id: 7,
                apm_error_rate: 4.5,
                apm_p95_ms: 1234.6
            });
        });

        test('returns null when there were no requests', () => {
            expect(buildApmMetric({
                host_id: 7,
                request_count: 0,
                error_count: 0,
                p95_ms: null
            })).toBeNull();
        });

        test('omits p95 when no request had a duration', () => {
            const metric = buildApmMetric({
                host_id: 7,
                request_count: 50,
                error_count: 0,
                p95_ms: null
            });

            expect(metric).toEqual({ host_id: 7, apm_error_rate: 0 });
            expect(metric).not.toHaveProperty('apm_p95_ms');
        });
    });

    describe('runApmAlertCheck', () => {
        test('queries with the configured window, metrics and minimum', async () => {
            process.env.APM_ALERT_WINDOW_MINUTES = '15';
            process.env.APM_ALERT_MIN_REQUESTS = '50';

            await runApmAlertCheck();

            expect(pool.query).toHaveBeenCalledTimes(1);
            expect(pool.query.mock.calls[0][1]).toEqual([
                15,
                APM_ALERT_METRICS
            ]);
        });

        test('does not evaluate anything when no host has enough traffic', async () => {
            const summary = await runApmAlertCheck();

            expect(evaluateAlerts).not.toHaveBeenCalled();
            expect(summary).toEqual({ hosts: 0, evaluated: 0, failed: 0 });
        });

        test('hands each host to the existing alert engine as a metric', async () => {
            pool.query.mockResolvedValue({
                rows: [
                    { host_id: 1, request_count: 100, error_count: 10, p95_ms: 800 },
                    { host_id: 2, request_count: 40, error_count: 0, p95_ms: 2500 }
                ]
            });

            const summary = await runApmAlertCheck();

            expect(evaluateAlerts).toHaveBeenNthCalledWith(1, {
                host_id: 1,
                apm_error_rate: 10,
                apm_p95_ms: 800
            }, { recoveryOnly: false });
            expect(evaluateAlerts).toHaveBeenNthCalledWith(2, {
                host_id: 2,
                apm_error_rate: 0,
                apm_p95_ms: 2500
            }, { recoveryOnly: false });
            expect(summary).toEqual({ hosts: 2, evaluated: 2, failed: 0 });
        });

        test('one failing host does not stop the others', async () => {
            pool.query.mockResolvedValue({
                rows: [
                    { host_id: 1, request_count: 100, error_count: 0, p95_ms: 100 },
                    { host_id: 2, request_count: 100, error_count: 0, p95_ms: 100 }
                ]
            });
            evaluateAlerts.mockRejectedValueOnce(new Error('db down'));

            const errorSpy = jest
                .spyOn(console, 'error')
                .mockImplementation(() => {});

            const summary = await runApmAlertCheck();

            expect(evaluateAlerts).toHaveBeenCalledTimes(2);
            expect(summary).toEqual({ hosts: 2, evaluated: 1, failed: 1 });

            errorSpy.mockRestore();
        });

        test('propagates a failure of the aggregation query', async () => {
            pool.query.mockRejectedValue(new Error('query failed'));

            await expect(runApmAlertCheck()).rejects.toThrow('query failed');
        });
    });
});
