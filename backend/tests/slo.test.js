
const {
    calculateSlo,
    ALLOWED_DOWNTIME_MINUTES
} = require('../src/utils/slo');

const NOW = new Date('2026-10-23T12:00:00.000Z');
const WINDOW_START = new Date(
    NOW.getTime() - 30 * 24 * 60 * 60 * 1000
);

function event(type, minutesAgo) {
    return {
        type,
        created_at: new Date(NOW.getTime() - minutesAgo * 60000)
    };
}

describe('calculateSlo', () => {
    test('uses a 99.9% target and 43.2-minute budget', () => {
        const result = calculateSlo(
            [event('UP', 60)],
            { now: NOW }
        );

        expect(result.target_percent).toBe(99.9);
        expect(result.allowed_downtime_minutes).toBe(43.2);
    });

    test('calculates a recovered outage duration', () => {
        const result = calculateSlo(
            [
                {
                    type: 'UP',
                    created_at: new Date(
                        WINDOW_START.getTime() - 60000
                    )
                },
                event('DOWN', 20),
                event('UP', 10)
            ],
            { now: NOW }
        );

        expect(result.observed_downtime_minutes).toBe(10);
        expect(result.remaining_budget_minutes).toBe(33.2);
        expect(result.status).toBe('within_budget');
    });

    test('counts an outage that is still ongoing', () => {
        const result = calculateSlo(
            [
                {
                    type: 'UP',
                    created_at: new Date(
                        WINDOW_START.getTime() - 60000
                    )
                },
                event('DOWN', 15)
            ],
            { now: NOW }
        );

        expect(result.observed_downtime_minutes).toBe(15);
        expect(result.remaining_budget_minutes).toBe(28.2);
    });

    test('marks the budget exhausted when downtime reaches the limit', () => {
        const result = calculateSlo(
            [
                {
                    type: 'UP',
                    created_at: new Date(
                        WINDOW_START.getTime() - 60000
                    )
                },
                {
                    type: 'DOWN',
                    created_at: new Date(
                        WINDOW_START.getTime() + 1000
                    )
                },
                event('UP', 0)
            ],
            { now: NOW }
        );

        expect(
            ALLOWED_DOWNTIME_MINUTES
        ).toBe(43.2);

        expect(result.status).toBe('exhausted');
        expect(result.remaining_budget_minutes).toBe(0);
    });

    test('returns insufficient data when there are no events', () => {
        const result = calculateSlo([], { now: NOW });

        expect(result.status).toBe('insufficient_data');
        expect(result.observed_downtime_minutes).toBeNull();
        expect(result.remaining_budget_minutes).toBeNull();
    });

    test('does not claim a complete budget when the first event is UP', () => {
        const result = calculateSlo(
            [event('UP', 20)],
            { now: NOW }
        );

        expect(result.status).toBe('insufficient_data');
        expect(result.remaining_budget_minutes).toBeNull();
    });

        test('counts downtime from the window start when an outage spans the boundary', () => {
        const result = calculateSlo(
            [
                {
                    type: 'DOWN',
                    created_at: new Date(
                        WINDOW_START.getTime() - 24 * 60 * 60 * 1000
                    )
                },
                event('UP', 10)
            ],
            { now: NOW }
        );

        expect(result.observed_downtime_minutes).toBe(43190);
        expect(result.remaining_budget_minutes).toBe(0);
        expect(result.status).toBe('exhausted');
    });

});
