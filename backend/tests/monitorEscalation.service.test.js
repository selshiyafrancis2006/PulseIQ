jest.mock('../src/config/db', () => ({
    query: jest.fn()
}));

jest.mock('../src/services/notification.service', () => ({
    notifyUser: jest.fn().mockResolvedValue([])
}));

const db = require('../src/config/db');
const { notifyUser } = require('../src/services/notification.service');
const {
    processEscalation
} = require('../src/services/monitorEscalation.service');

const monitor = {
    id: 12,
    user_id: 7,
    name: 'Production API',
    url: 'https://example.com'
};

const downResult = {
    status: 'DOWN',
    responseTime: 450,
    statusCode: 503,
    errorType: 'HTTP_ERROR',
    errorMessage: 'Service unavailable'
};

function configureDownState({
    elapsed = 900,
    currentStage = 0,
    stages = []
} = {}) {
    db.query.mockImplementation(async (sql) => {
        if (sql.includes('SELECT GREATEST')) {
            return {
                rows: [{
                    active_outage_seconds: elapsed,
                    escalation_stage: currentStage
                }]
            };
        }

        if (sql.includes('SELECT') && sql.includes('stages.stage_number')) {
            return { rows: stages };
        }

        if (sql.includes('RETURNING escalation_stage')) {
            return { rows: [{ escalation_stage: 1 }] };
        }

        return { rows: [] };
    });
}

describe('processEscalation', () => {
    beforeEach(() => {
        db.query.mockReset();
        notifyUser.mockClear();
        notifyUser.mockResolvedValue([]);
    });

    test('sends a due SELECTED stage to only its configured channels', async () => {
        configureDownState({
            elapsed: 900,
            stages: [{
                stage_number: 1,
                delay_minutes: 10,
                routing_mode: 'SELECTED',
                channel_ids: [3, 8]
            }]
        });

        await processEscalation(monitor, downResult, false);

        expect(notifyUser).toHaveBeenCalledWith(
            7,
            expect.objectContaining({
                type: 'ESCALATION',
                escalationStage: 1,
                downForSeconds: 900,
                statusCode: 503,
                errorMessage: 'Service unavailable'
            }),
            [3, 8],
            true
        );
    });

    test('ALL stage bypasses monitor-level notification routing', async () => {
        configureDownState({
            elapsed: 1200,
            stages: [{
                stage_number: 1,
                delay_minutes: 10,
                routing_mode: 'ALL',
                channel_ids: []
            }]
        });

        await processEscalation(monitor, downResult, false);

        expect(notifyUser).toHaveBeenCalledWith(
            7,
            expect.objectContaining({
                type: 'ESCALATION',
                escalationStage: 1
            }),
            null,
            true
        );
    });

    test('does not dispatch a stage before its delay has elapsed', async () => {
        configureDownState({
            elapsed: 599,
            stages: [{
                stage_number: 1,
                delay_minutes: 10,
                routing_mode: 'ALL',
                channel_ids: []
            }]
        });

        await processEscalation(monitor, downResult, false);

        expect(notifyUser).not.toHaveBeenCalled();
        expect(
            db.query.mock.calls.some(([sql]) =>
                sql.includes('RETURNING escalation_stage')
            )
        ).toBe(false);
    });

    test('pauses the outage clock while the monitor is flapping', async () => {
        db.query.mockResolvedValue({ rows: [] });

        await processEscalation(monitor, downResult, true);

        expect(db.query).toHaveBeenCalledTimes(2);
        expect(db.query.mock.calls[1][0]).toContain(
            'escalation_paused_at = COALESCE'
        );
        expect(notifyUser).not.toHaveBeenCalled();
    });

    test('resets escalation state when the monitor recovers', async () => {
        db.query.mockResolvedValue({ rows: [] });

        await processEscalation(
            monitor,
            { status: 'UP' },
            false
        );

        expect(db.query).toHaveBeenCalledTimes(1);
        expect(db.query.mock.calls[0][0]).toContain(
            'outage_started_at = NULL'
        );
        expect(db.query.mock.calls[0][0]).toContain(
            'escalation_stage = 0'
        );
        expect(db.query.mock.calls[0][0]).toContain(
            'escalation_paused_seconds = 0'
        );
        expect(notifyUser).not.toHaveBeenCalled();
    });

    test('does not process escalation for a monitor without an owner', async () => {
        await processEscalation(
            { ...monitor, user_id: null },
            downResult,
            false
        );

        expect(db.query).not.toHaveBeenCalled();
        expect(notifyUser).not.toHaveBeenCalled();
    });
});
