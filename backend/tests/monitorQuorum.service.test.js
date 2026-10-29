jest.mock('../src/config/db', () => ({
    query: jest.fn()
}));

const db = require('../src/config/db');
const {
    evaluateMonitorQuorum
} = require('../src/services/monitorQuorum.service');

describe('evaluateMonitorQuorum', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        db.query.mockResolvedValue({ rows: [] });
    });

    test('preserves existing behavior when quorum is 1', async () => {
        const central = { status: 'DOWN', responseTime: 20 };

        await expect(
            evaluateMonitorQuorum({ id: 1, quorum: 1 }, central)
        ).resolves.toEqual(central);

        expect(db.query).not.toHaveBeenCalled();
    });

    test('returns DOWN when enough fresh locations vote DOWN', async () => {
        db.query.mockResolvedValue({
            rows: [
                { host_id: 10, status: 'DOWN' },
                { host_id: 11, status: 'UP' }
            ]
        });

        const result = await evaluateMonitorQuorum(
            { id: 2, quorum: 2, interval_seconds: 30 },
            { status: 'DOWN', responseTime: 25 }
        );

        expect(result.status).toBe('DOWN');
        expect(db.query).toHaveBeenCalledWith(
            expect.stringContaining("INTERVAL '1 second'"),
            [2, 60]
        );
    });

    test('returns UP when enough locations vote UP', async () => {
        db.query.mockResolvedValue({
            rows: [
                { host_id: 10, status: 'UP' },
                { host_id: 11, status: 'DOWN' }
            ]
        });

        const result = await evaluateMonitorQuorum(
            { id: 3, quorum: 2, interval_seconds: 30 },
            { status: 'UP', responseTime: 18 }
        );

        expect(result.status).toBe('UP');
        expect(result.errorType).toBeNull();
        expect(result.errorMessage).toBeNull();
    });

    test('returns null when there are insufficient matching votes', async () => {
        db.query.mockResolvedValue({
            rows: [
                { host_id: 10, status: 'UP' },
                { host_id: 11, status: null }
            ]
        });

        const result = await evaluateMonitorQuorum(
            { id: 4, quorum: 2, interval_seconds: 30 },
            { status: 'DOWN', responseTime: 40 }
        );

        expect(result).toBeNull();
    });

    test('uses only the latest fresh result per assigned host', async () => {
        db.query.mockResolvedValue({
            rows: [
                { host_id: 10, status: 'DOWN' }
            ]
        });

        await evaluateMonitorQuorum(
            { id: 5, quorum: 2, interval_seconds: 90 },
            { status: 'DOWN' }
        );

        expect(db.query).toHaveBeenCalledWith(
            expect.stringContaining('ORDER BY r.checked_at DESC, r.id DESC'),
            [5, 180]
        );
    });
    test('returns null when conflicting votes both reach quorum', async () => {
        db.query.mockResolvedValue({
            rows: [
                { host_id: 10, status: 'DOWN' },
                { host_id: 11, status: 'UP' },
                { host_id: 12, status: 'UP' }
            ]
        });

        const result = await evaluateMonitorQuorum(
            { id: 6, quorum: 2, interval_seconds: 30 },
            { status: 'DOWN' }
        );

        expect(result).toBeNull();
    });
});

