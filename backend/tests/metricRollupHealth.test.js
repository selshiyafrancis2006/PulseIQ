describe('metric rollup health service', () => {
    let health;

    beforeEach(() => {
        jest.resetModules();
        health = require('../src/services/metricRollupHealth.service');
    });

    test('starts with both jobs never having succeeded', () => {
        const result = health.getRollupHealth();

        expect(result.jobs['5m'].lastSuccessAt).toBeNull();
        expect(result.jobs['1h'].lastSuccessAt).toBeNull();
        expect(result.jobs['5m'].consecutiveFailures).toBe(0);
        expect(result.jobs['5m'].status).toBe('never_succeeded');
        expect(result.jobs['1h'].healthy).toBe(false);
    });

    test('records successful rollup completion', () => {
        const completedAt = new Date('2026-11-19T05:00:00.000Z');

        health.recordRollupSuccess('5m', completedAt);

        expect(health.getRollupHealth().jobs['5m']).toMatchObject({
            lastSuccessAt: completedAt.toISOString(),
            lastError: null,
            consecutiveFailures: 0
        });
    });

    test('records failure details and increments consecutive failures', () => {
        const failedAt = new Date('2026-11-19T05:05:00.000Z');

        health.recordRollupFailure(
            '5m',
            new Error('Database unavailable'),
            failedAt
        );

        health.recordRollupFailure('5m', 'Connection timeout');

        expect(health.getRollupHealth().jobs['5m']).toMatchObject({
            lastFailureAt: expect.any(String),
            lastError: 'Connection timeout',
            consecutiveFailures: 2
        });
    });

    test('preserves last success while recording a later failure', () => {
        const completedAt = new Date('2026-11-19T05:00:00.000Z');

        health.recordRollupSuccess('1h', completedAt);
        health.recordRollupFailure('1h', new Error('Temporary failure'));

        expect(health.getRollupHealth().jobs['1h']).toMatchObject({
            lastSuccessAt: completedAt.toISOString(),
            lastError: 'Temporary failure',
            consecutiveFailures: 1
        });
    });

    test('resets consecutive failures after recovery', () => {
        health.recordRollupFailure('5m', new Error('First failure'));
        health.recordRollupFailure('5m', new Error('Second failure'));
        health.recordRollupSuccess(
            '5m',
            new Date('2026-11-19T05:15:00.000Z')
        );

        expect(health.getRollupHealth().jobs['5m']).toMatchObject({
            lastError: null,
            consecutiveFailures: 0,
            lastSuccessAt: '2026-11-19T05:15:00.000Z'
        });
    });

    test('marks five-minute rollup stale after 15 minutes', () => {
        const completedAt = new Date('2026-11-19T05:00:00.000Z');
        const now = new Date('2026-11-19T05:15:01.000Z');

        health.recordRollupSuccess('5m', completedAt);

        expect(health.getRollupHealth(now).jobs['5m']).toMatchObject({
            healthy: false,
            status: 'stale',
            staleAfterSeconds: 900,
            lastSuccessAgeSeconds: 901
        });
    });

    test('keeps five-minute rollup healthy at the 15-minute boundary', () => {
        health.recordRollupSuccess(
            '5m',
            new Date('2026-11-19T05:00:00.000Z')
        );

        expect(
            health.getRollupHealth(
                new Date('2026-11-19T05:15:00.000Z')
            ).jobs['5m'].healthy
        ).toBe(true);
    });

    test('marks hourly rollup stale after 90 minutes', () => {
        health.recordRollupSuccess(
            '1h',
            new Date('2026-11-19T04:00:00.000Z')
        );

        expect(
            health.getRollupHealth(
                new Date('2026-11-19T05:30:01.000Z')
            ).jobs['1h']
        ).toMatchObject({
            healthy: false,
            status: 'stale',
            staleAfterSeconds: 5400,
            lastSuccessAgeSeconds: 5401
        });
    });

    test('restores healthy status after a successful run', () => {
        health.recordRollupSuccess(
            '5m',
            new Date('2026-11-19T05:00:00.000Z')
        );

        const stale = health.getRollupHealth(
            new Date('2026-11-19T05:16:00.000Z')
        );
        expect(stale.jobs['5m'].healthy).toBe(false);

        health.recordRollupSuccess(
            '5m',
            new Date('2026-11-19T05:17:00.000Z')
        );

        const recovered = health.getRollupHealth(
            new Date('2026-11-19T05:17:01.000Z')
        );

        expect(recovered.jobs['5m']).toMatchObject({
            healthy: true,
            status: 'healthy',
            consecutiveFailures: 0
        });
    });

    test('rejects unknown job names', () => {
        expect(() => health.recordRollupSuccess('daily')).toThrow(
            'Unknown metric rollup job: daily'
        );

        expect(() => health.recordRollupFailure('daily', 'error')).toThrow(
            'Unknown metric rollup job: daily'
        );
    });
});

describe('metric rollup health - saved state and cleanup job', () => {
    let health;

    beforeEach(() => {
        jest.resetModules();
        health = require('../src/services/metricRollupHealth.service');
    });

    test('tracks the daily cleanup job and allows 26 hours before it is stale', () => {
        const now = new Date('2026-11-20T12:00:00.000Z');

        expect(health.getRollupHealth(now).jobs.cleanup.status).toBe('never_succeeded');

        health.recordRollupSuccess('cleanup', new Date(now.getTime() - 26 * 60 * 60 * 1000));
        expect(health.getRollupHealth(now).jobs.cleanup.status).toBe('healthy');

        health.recordRollupSuccess('cleanup', new Date(now.getTime() - 26 * 60 * 60 * 1000 - 1000));
        expect(health.getRollupHealth(now).jobs.cleanup.status).toBe('stale');
    });

    test('hydrates saved state so a restart does not look like a stalled job', () => {
        const now = new Date('2026-11-20T12:00:00.000Z');

        health.hydrateRollupHealth([
            {
                jobName: '5m',
                lastSuccessAt: '2026-11-20T11:58:00.000Z',
                lastFailureAt: '2026-11-20T11:30:00.000Z',
                lastError: 'earlier failure',
                consecutiveFailures: 0
            }
        ]);

        expect(health.getRollupHealth(now).jobs['5m']).toMatchObject({
            lastSuccessAt: '2026-11-20T11:58:00.000Z',
            lastFailureAt: '2026-11-20T11:30:00.000Z',
            lastError: 'earlier failure',
            healthy: true,
            status: 'healthy'
        });
    });

    test('a hydrated job that is too old is reported stale', () => {
        health.hydrateRollupHealth([
            { jobName: '1h', lastSuccessAt: '2026-11-20T08:02:00.000Z', consecutiveFailures: 0 }
        ]);

        expect(
            health.getRollupHealth(new Date('2026-11-20T12:00:00.000Z')).jobs['1h'].status
        ).toBe('stale');
    });

    test('hydration ignores unknown jobs, malformed rows and non-arrays', () => {
        expect(() => {
            health.hydrateRollupHealth(undefined);
            health.hydrateRollupHealth(null);
            health.hydrateRollupHealth([
                null,
                'text',
                { jobName: 'nope', lastSuccessAt: '2026-11-20T11:58:00.000Z' },
                { jobName: '5m', lastSuccessAt: 'not a date', consecutiveFailures: -4 }
            ]);
        }).not.toThrow();

        expect(health.getRollupHealth().jobs['5m']).toMatchObject({
            lastSuccessAt: null,
            consecutiveFailures: 0
        });
    });

    test('hydration does not overwrite a job that already ran in this process', () => {
        const ranAt = new Date('2026-11-20T11:59:00.000Z');

        health.recordRollupSuccess('5m', ranAt);
        health.hydrateRollupHealth([
            { jobName: '5m', lastSuccessAt: '2026-11-19T00:00:00.000Z', consecutiveFailures: 3 }
        ]);

        expect(health.getJobState('5m')).toMatchObject({
            lastSuccessAt: ranAt.toISOString(),
            consecutiveFailures: 0
        });
    });

    test('getJobState returns a copy and rejects unknown jobs', () => {
        health.getJobState('5m').consecutiveFailures = 99;

        expect(health.getJobState('5m').consecutiveFailures).toBe(0);
        expect(() => health.getJobState('nope')).toThrow('Unknown metric rollup job');
    });
});