jest.mock('../src/config/db', () => ({
    connect: jest.fn(),
    query: jest.fn()
}));

jest.mock('../src/services/notification.service', () => ({
    sendSystemAlert: jest.fn()
}));

const db = require('../src/config/db');
const { sendSystemAlert } = require('../src/services/notification.service');

const {
    processRollupAlert
} = require('../src/services/metricRollupAlert.service');

describe('metricRollupAlert.service', () => {
    let client;

    beforeEach(() => {
        jest.clearAllMocks();

        client = {
            query: jest.fn(),
            release: jest.fn()
        };

        client.query
            .mockResolvedValueOnce({ rows: [] }) // BEGIN
            .mockResolvedValueOnce({ rows: [] }) // INSERT
            .mockResolvedValueOnce({
                rows: [{ is_stale: false, pending_event: null }]
            }) // SELECT
            .mockResolvedValueOnce({ rows: [] }) // UPDATE transition
            .mockResolvedValueOnce({ rows: [] }); // COMMIT

        db.connect.mockResolvedValue(client);

        sendSystemAlert.mockResolvedValue({
            configured: true,
            delivered: 1,
            failed: 0,
            results: [{ type: 'webhook', ok: true, error: null }]
        });
    });

    const staleHealth = {
        status: 'stale',
        lastSuccessAt: '2026-11-20T10:00:00.000Z',
        staleAfterSeconds: 900,
        lastSuccessAgeSeconds: 1200,
        lastError: 'Database timeout',
        consecutiveFailures: 3
    };

    test('does not create an alert for a job that has never succeeded', async () => {
        const result = await processRollupAlert('5m', {
            status: 'never_succeeded'
        });

        expect(result).toEqual({
            processed: false,
            reason: 'health_not_evaluable'
        });

        expect(db.connect).not.toHaveBeenCalled();
        expect(sendSystemAlert).not.toHaveBeenCalled();
    });

    test('creates and delivers a stale transition', async () => {
        const result = await processRollupAlert('5m', staleHealth);

        expect(client.query).toHaveBeenCalledWith(
            expect.stringContaining('SET is_stale = $2'),
            [
                '5m',
                true,
                expect.any(String)
            ]
        );

        expect(sendSystemAlert).toHaveBeenCalledWith(
            expect.objectContaining({
                type: 'SYSTEM_ROLLUP_STALE',
                jobName: '5m',
                lastSuccessAt: staleHealth.lastSuccessAt,
                staleAfterSeconds: 900,
                lastError: 'Database timeout',
                consecutiveFailures: 3,
                eventId: expect.any(String)
            })
        );

        expect(db.query).toHaveBeenCalledWith(
            expect.stringContaining('SET pending_event = NULL'),
            ['5m', expect.any(String)]
        );

        expect(result.processed).toBe(true);
        expect(result.eventPending).toBe(false);
        expect(result.eventType).toBe('SYSTEM_ROLLUP_STALE');
        expect(client.release).toHaveBeenCalledTimes(1);
    });

    test('retains a pending event when no destinations are configured', async () => {
        sendSystemAlert.mockResolvedValueOnce({
            configured: false,
            delivered: 0,
            failed: 0,
            results: []
        });

        const result = await processRollupAlert('5m', staleHealth);

        expect(result.eventPending).toBe(true);
        expect(result.delivery.reason).toBe('no_destinations_configured');
        expect(db.query).not.toHaveBeenCalled();
    });

    test('retains a pending event when delivery partially fails', async () => {
        sendSystemAlert.mockResolvedValueOnce({
            configured: true,
            delivered: 1,
            failed: 1,
            results: [
                { type: 'email', ok: true, error: null },
                { type: 'webhook', ok: false, error: 'Unavailable' }
            ]
        });

        const result = await processRollupAlert('5m', staleHealth);

        expect(result.eventPending).toBe(true);
        expect(result.delivery.reason).toBe('partial_or_failed_delivery');
        expect(db.query).not.toHaveBeenCalled();
    });

    test('retries an existing pending event without creating a new transition', async () => {
        const pendingEvent = {
            eventId: 'existing-event-123',
            type: 'SYSTEM_ROLLUP_STALE',
            jobName: '5m',
            occurredAt: '2026-11-20T10:30:00.000Z'
        };

        client.query.mockReset();
        client.query
            .mockResolvedValueOnce({ rows: [] }) // BEGIN
            .mockResolvedValueOnce({ rows: [] }) // INSERT
            .mockResolvedValueOnce({
                rows: [{ is_stale: true, pending_event: pendingEvent }]
            }) // SELECT
            .mockResolvedValueOnce({ rows: [] }); // COMMIT

        const result = await processRollupAlert('5m', staleHealth);

        expect(sendSystemAlert).toHaveBeenCalledWith(pendingEvent);
        expect(client.query).toHaveBeenCalledTimes(4);
        expect(client.query.mock.calls.some(([sql]) =>
            String(sql).includes('SET is_stale = $2')
        )).toBe(false);

        expect(db.query).toHaveBeenCalledWith(
            expect.stringContaining("pending_event->>'eventId' = $2"),
            ['5m', 'existing-event-123']
        );

        expect(result.eventPending).toBe(false);
    });

    test('creates a recovery event when a stale job becomes healthy', async () => {
        client.query.mockReset();
        client.query
            .mockResolvedValueOnce({ rows: [] })
            .mockResolvedValueOnce({ rows: [] })
            .mockResolvedValueOnce({
                rows: [{ is_stale: true, pending_event: null }]
            })
            .mockResolvedValueOnce({ rows: [] })
            .mockResolvedValueOnce({ rows: [] });

        const result = await processRollupAlert('5m', {
            status: 'healthy',
            lastSuccessAt: '2026-11-20T11:00:00.000Z',
            staleAfterSeconds: 900,
            lastSuccessAgeSeconds: 60,
            lastError: null,
            consecutiveFailures: 0
        });

        expect(sendSystemAlert).toHaveBeenCalledWith(
            expect.objectContaining({
                type: 'SYSTEM_ROLLUP_RECOVERED',
                jobName: '5m'
            })
        );

        expect(result.eventType).toBe('SYSTEM_ROLLUP_RECOVERED');
        expect(result.eventPending).toBe(false);
    });

    test('rolls back and releases the client when the transaction fails', async () => {
        client.query.mockReset();
        client.query
            .mockResolvedValueOnce({ rows: [] }) // BEGIN
            .mockRejectedValueOnce(new Error('Database unavailable')) // INSERT
            .mockResolvedValueOnce({ rows: [] }); // ROLLBACK

        await expect(
            processRollupAlert('5m', staleHealth)
        ).rejects.toThrow('Database unavailable');

        expect(client.query).toHaveBeenLastCalledWith('ROLLBACK');
        expect(client.release).toHaveBeenCalledTimes(1);
        expect(sendSystemAlert).not.toHaveBeenCalled();
    });

    test('rejects unknown job names', async () => {
        await expect(
            processRollupAlert('15m', staleHealth)
        ).rejects.toThrow('Unknown metric rollup job: 15m');

        expect(db.connect).not.toHaveBeenCalled();
    });
});
