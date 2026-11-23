jest.mock('node-cron', () => ({
    schedule: jest.fn()
}));

jest.mock('../src/services/metricRollup.service', () => ({
    withMetricRollupLock: jest.fn(async (callback) => callback({ query: jest.fn() })),
    rollup5Minute: jest.fn(),
    rollup1Hour: jest.fn(),
    cleanupRawMetrics: jest.fn(),
    cleanupHistoricalData: jest.fn(),
    RAW_RETENTION_DAYS: 3
}));

jest.mock('../src/services/jobRunStore.service', () => ({
    saveJobRun: jest.fn(async () => {}),
    loadJobRunsStrict: jest.fn(async () => [])
}));

jest.mock('../src/services/monitorRollup.service', () => ({
    rollupRecentMonitorResults: jest.fn(),
    cleanupMonitorResults: jest.fn()
}));

jest.mock('../src/services/metricRollupAlert.service', () => ({
    processRollupAlerts: jest.fn().mockResolvedValue({})
}));

describe('metric rollup scheduler', () => {
    let cron;
    let withMetricRollupLock;
    let rollup5Minute;
    let rollup1Hour;

    beforeEach(() => {
        jest.resetModules();

        cron = require('node-cron');

        ({
            withMetricRollupLock,
            rollup5Minute,
            rollup1Hour
        } = require('../src/services/metricRollup.service'));

        withMetricRollupLock.mockImplementation(async (callback) => callback({ query: jest.fn() }));
        rollup5Minute.mockResolvedValue();
        rollup1Hour.mockResolvedValue();

        require('../src/jobs/rollup.job');
    });

    test('registers serialized metric schedules with noOverlap', () => {
        expect(cron.schedule).toHaveBeenNthCalledWith(
            1,
            '*/5 * * * *',
            expect.any(Function),
            { noOverlap: true }
        );

        expect(cron.schedule).toHaveBeenNthCalledWith(
            2,
            '2 * * * *',
            expect.any(Function),
            { noOverlap: true }
        );
    });

    test('waits for the 5-minute rollup before starting the hourly rollup', async () => {
        let finishFiveMinute;

        rollup5Minute.mockImplementation(
            () => new Promise((resolve) => {
                finishFiveMinute = resolve;
            })
        );

        const fiveMinuteCallback = cron.schedule.mock.calls[0][1];
        const hourlyCallback = cron.schedule.mock.calls[1][1];

        const fiveMinuteRun = fiveMinuteCallback();

        await Promise.resolve();

        expect(rollup5Minute).toHaveBeenCalledTimes(1);

        const hourlyRun = hourlyCallback();

        await Promise.resolve();

        expect(rollup1Hour).not.toHaveBeenCalled();

        finishFiveMinute();

        await Promise.all([fiveMinuteRun, hourlyRun]);

        expect(rollup1Hour).toHaveBeenCalledTimes(1);
    });

    test('continues processing after a metric rollup fails', async () => {
        const errorSpy = jest
            .spyOn(console, 'error')
            .mockImplementation(() => {});

        try {
            rollup5Minute.mockRejectedValueOnce(
                new Error('Simulated rollup failure')
            );

            const fiveMinuteCallback = cron.schedule.mock.calls[0][1];
            const hourlyCallback = cron.schedule.mock.calls[1][1];

            await fiveMinuteCallback();
            await hourlyCallback();

            expect(rollup1Hour).toHaveBeenCalledTimes(1);
            expect(errorSpy).toHaveBeenCalled();
        } finally {
            errorSpy.mockRestore();
        }
    });

    test('saves the state of a metric rollup after it succeeds', async () => {
        const { saveJobRun } = require('../src/services/jobRunStore.service');

        await cron.schedule.mock.calls[0][1]();

        expect(saveJobRun).toHaveBeenCalledWith(
            '5m',
            expect.objectContaining({
                lastSuccessAt: expect.any(String),
                consecutiveFailures: 0
            })
        );
    });

    test('saves the failure of a metric rollup', async () => {
        const { saveJobRun } = require('../src/services/jobRunStore.service');
        const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

        try {
            rollup1Hour.mockRejectedValueOnce(new Error('Simulated hourly failure'));

            await cron.schedule.mock.calls[1][1]();

            expect(saveJobRun).toHaveBeenCalledWith(
                '1h',
                expect.objectContaining({
                    lastError: 'Simulated hourly failure',
                    consecutiveFailures: 1
                })
            );
        } finally {
            errorSpy.mockRestore();
        }
    });

    test('tracks the daily cleanup as one job that succeeds when every step succeeds', async () => {
        const { saveJobRun } = require('../src/services/jobRunStore.service');
        const cleanup = cron.schedule.mock.calls.find((call) => call[0] === '0 3 * * *')[1];

        await cleanup();

        expect(saveJobRun).toHaveBeenCalledWith(
            'cleanup',
            expect.objectContaining({
                lastSuccessAt: expect.any(String),
                consecutiveFailures: 0
            })
        );
    });

    test('a failing cleanup step still runs the other steps and records a failure', async () => {
        const { saveJobRun } = require('../src/services/jobRunStore.service');
        const { cleanupRawMetrics, cleanupHistoricalData } =
            require('../src/services/metricRollup.service');
        const { cleanupMonitorResults } =
            require('../src/services/monitorRollup.service');
        const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

        try {
            cleanupRawMetrics.mockRejectedValueOnce(new Error('Raw cleanup failed'));

            const cleanup = cron.schedule.mock.calls.find((call) => call[0] === '0 3 * * *')[1];

            await cleanup();

            expect(cleanupHistoricalData).toHaveBeenCalled();
            expect(cleanupMonitorResults).toHaveBeenCalled();
            expect(saveJobRun).toHaveBeenCalledWith(
                'cleanup',
                expect.objectContaining({
                    lastError: 'Raw cleanup failed',
                    consecutiveFailures: 1
                })
            );
        } finally {
            errorSpy.mockRestore();
        }
    });
});

describe('metric rollup scheduler - saved job state', () => {
    test('restores saved state when the backend starts', async () => {
        jest.resetModules();

        const { loadJobRunsStrict } = require('../src/services/jobRunStore.service');

        loadJobRunsStrict.mockResolvedValueOnce([
            {
                jobName: '5m',
                lastSuccessAt: '2026-11-20T11:58:00.000Z',
                lastFailureAt: null,
                lastError: null,
                consecutiveFailures: 0
            }
        ]);

        require('../src/jobs/rollup.job');
        await new Promise((resolve) => setImmediate(resolve));

        const health = require('../src/services/metricRollupHealth.service');

        expect(health.getJobState('5m').lastSuccessAt).toBe('2026-11-20T11:58:00.000Z');
    });
});
describe('metric rollup scheduler - hydration retry', () => {
    beforeEach(() => {
        jest.resetModules();
    });

    test('does not mark health ready when strict hydration fails', async () => {
        const { loadJobRunsStrict } =
            require('../src/services/jobRunStore.service');

        loadJobRunsStrict.mockRejectedValueOnce(
            new Error('Database unavailable')
        );

        const errorSpy = jest
            .spyOn(console, 'error')
            .mockImplementation(() => {});

        try {
            const { ensureRollupHealthReady } =
                require('../src/jobs/rollup.job');

            await expect(ensureRollupHealthReady()).resolves.toBe(false);

            expect(loadJobRunsStrict).toHaveBeenCalledTimes(1);
            expect(errorSpy).toHaveBeenCalledWith(
                'Could not restore saved job run state:',
                expect.objectContaining({
                    message: 'Database unavailable'
                })
            );
        } finally {
            errorSpy.mockRestore();
        }
    });

    test('retries failed hydration and restores saved state after recovery', async () => {
        const { loadJobRunsStrict } =
            require('../src/services/jobRunStore.service');

        loadJobRunsStrict
            .mockRejectedValueOnce(new Error('Database unavailable'))
            .mockResolvedValueOnce([
                {
                    jobName: '5m',
                    lastSuccessAt: '2026-11-20T11:58:00.000Z',
                    lastFailureAt: null,
                    lastError: null,
                    consecutiveFailures: 0
                }
            ]);

        const errorSpy = jest
            .spyOn(console, 'error')
            .mockImplementation(() => {});

        try {
            const { ensureRollupHealthReady } =
                require('../src/jobs/rollup.job');

            await expect(ensureRollupHealthReady()).resolves.toBe(false);
            await expect(ensureRollupHealthReady()).resolves.toBe(true);

            expect(loadJobRunsStrict).toHaveBeenCalledTimes(2);

            const health = require('../src/services/metricRollupHealth.service');

            expect(health.getJobState('5m').lastSuccessAt)
                .toBe('2026-11-20T11:58:00.000Z');
        } finally {
            errorSpy.mockRestore();
        }
    });
});


describe('metric rollup alert scheduler', () => {
    beforeEach(() => {
        jest.resetModules();
    });

    test('registers a non-overlapping once-per-minute alert check', () => {
        const cron = require('node-cron');

        require('../src/jobs/rollup.job');

        expect(cron.schedule).toHaveBeenNthCalledWith(
            5,
            '* * * * *',
            expect.any(Function),
            { noOverlap: true }
        );
    });

    test('evaluates rollup alerts after health hydration succeeds', async () => {
        const { processRollupAlerts } =
            require('../src/services/metricRollupAlert.service');

        const { runRollupAlertCheck } =
            require('../src/jobs/rollup.job');

        await runRollupAlertCheck();

        expect(processRollupAlerts).toHaveBeenCalledTimes(1);
        expect(processRollupAlerts).toHaveBeenCalledWith(
            expect.objectContaining({
                jobs: expect.any(Object)
            })
        );
    });

    test('skips alert evaluation when health hydration fails', async () => {
        const { loadJobRunsStrict } =
            require('../src/services/jobRunStore.service');

        const { processRollupAlerts } =
            require('../src/services/metricRollupAlert.service');

        loadJobRunsStrict.mockRejectedValueOnce(
            new Error('Database unavailable')
        );

        const errorSpy = jest
            .spyOn(console, 'error')
            .mockImplementation(() => {});

        try {
            const { runRollupAlertCheck } =
                require('../src/jobs/rollup.job');

            await runRollupAlertCheck();

            expect(processRollupAlerts).not.toHaveBeenCalled();
        } finally {
            errorSpy.mockRestore();
        }
    });
});


describe('metric rollup scheduler - remaining job paths', () => {
    let cron;
    let errorSpy;
    let logSpy;

    const findJob = (expression) =>
        cron.schedule.mock.calls.find((call) => call[0] === expression)[1];

    beforeEach(() => {
        jest.resetModules();

        errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
        logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

        cron = require('node-cron');
        require('../src/jobs/rollup.job');
    });

    afterEach(() => {
        errorSpy.mockRestore();
        logSpy.mockRestore();
    });

    test('hourly monitor rollup reports how many buckets it upserted', async () => {
        const { rollupRecentMonitorResults } =
            require('../src/services/monitorRollup.service');

        rollupRecentMonitorResults.mockResolvedValueOnce(7);

        await findJob('5 * * * *')();

        expect(rollupRecentMonitorResults).toHaveBeenCalledWith(3);
        expect(logSpy).toHaveBeenCalledWith(
            'Monitor rollup complete: 7 hourly buckets upserted'
        );
    });

    test('hourly monitor rollup logs a failure instead of throwing', async () => {
        const { rollupRecentMonitorResults } =
            require('../src/services/monitorRollup.service');

        rollupRecentMonitorResults.mockRejectedValueOnce(new Error('monitor db down'));

        await expect(findJob('5 * * * *')()).resolves.toBeUndefined();

        expect(errorSpy).toHaveBeenCalledWith(
            'Monitor rollup error:',
            expect.objectContaining({ message: 'monitor db down' })
        );
    });

    test('daily cleanup records a failure when only the historical cleanup fails', async () => {
        const { saveJobRun } = require('../src/services/jobRunStore.service');
        const { cleanupRawMetrics, cleanupHistoricalData } =
            require('../src/services/metricRollup.service');
        const { cleanupMonitorResults } =
            require('../src/services/monitorRollup.service');

        cleanupHistoricalData.mockRejectedValueOnce(new Error('Historical cleanup failed'));

        await findJob('0 3 * * *')();

        expect(cleanupRawMetrics).toHaveBeenCalled();
        expect(cleanupMonitorResults).toHaveBeenCalled();
        expect(saveJobRun).toHaveBeenCalledWith(
            'cleanup',
            expect.objectContaining({
                lastError: 'Historical cleanup failed',
                consecutiveFailures: 1
            })
        );
    });

    test('daily cleanup records a failure when only the monitor cleanup fails', async () => {
        const { saveJobRun } = require('../src/services/jobRunStore.service');
        const { cleanupMonitorResults } =
            require('../src/services/monitorRollup.service');

        cleanupMonitorResults.mockRejectedValueOnce(new Error('Monitor cleanup failed'));

        await findJob('0 3 * * *')();

        expect(saveJobRun).toHaveBeenCalledWith(
            'cleanup',
            expect.objectContaining({
                lastError: 'Monitor cleanup failed',
                consecutiveFailures: 1
            })
        );
    });

    test('daily cleanup reports the first error when several steps fail', async () => {
        const { saveJobRun } = require('../src/services/jobRunStore.service');
        const { cleanupRawMetrics, cleanupHistoricalData } =
            require('../src/services/metricRollup.service');
        const { cleanupMonitorResults } =
            require('../src/services/monitorRollup.service');

        cleanupRawMetrics.mockRejectedValueOnce(new Error('first failure'));
        cleanupHistoricalData.mockRejectedValueOnce(new Error('second failure'));
        cleanupMonitorResults.mockRejectedValueOnce(new Error('third failure'));

        await findJob('0 3 * * *')();

        expect(saveJobRun).toHaveBeenCalledWith(
            'cleanup',
            expect.objectContaining({
                lastError: 'first failure',
                consecutiveFailures: 1
            })
        );
    });

    test('the alert check logs an error instead of throwing when alert processing fails', async () => {
        const { processRollupAlerts } =
            require('../src/services/metricRollupAlert.service');
        const { runRollupAlertCheck } = require('../src/jobs/rollup.job');

        processRollupAlerts.mockRejectedValueOnce(new Error('notification outage'));

        await expect(runRollupAlertCheck()).resolves.toBeUndefined();

        expect(errorSpy).toHaveBeenCalledWith(
            'Metric rollup alert check failed:',
            expect.objectContaining({ message: 'notification outage' })
        );
    });

    test('saved job state is loaded once and reused after it is ready', async () => {
        const { loadJobRunsStrict } = require('../src/services/jobRunStore.service');
        const { ensureRollupHealthReady } = require('../src/jobs/rollup.job');

        await expect(ensureRollupHealthReady()).resolves.toBe(true);
        await expect(ensureRollupHealthReady()).resolves.toBe(true);
        await expect(ensureRollupHealthReady()).resolves.toBe(true);

        expect(loadJobRunsStrict).toHaveBeenCalledTimes(1);
    });
});