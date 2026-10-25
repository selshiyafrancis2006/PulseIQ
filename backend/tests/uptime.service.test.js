
jest.mock('../src/config/db', () => ({
    query: jest.fn()
}));

jest.mock('../src/services/httpCheck.service', () => ({
    checkHttp: jest.fn()
}));

jest.mock('../src/services/checkError.service', () => ({
    classifyCheckError: jest.fn()
}));

const db = require('../src/config/db');
const { checkHttp } = require('../src/services/httpCheck.service');
const { classifyCheckError } = require('../src/services/checkError.service');
const { checkMonitor } = require('../src/services/uptime.service');

describe('checkMonitor', () => {
    beforeEach(() => {
        jest.clearAllMocks();

        db.query.mockResolvedValue({ rows: [] });
    });

    test('stores a successful HTTP check', async () => {
checkHttp.mockResolvedValue({
    statusCode: 200,
    responseTimeMs: 42,
    dnsTimeMs: 5.5,
    connectTimeMs: 8.25,
    tlsTimeMs: 12.75,
    ttfbTimeMs: 30.5,
    downloadTimeMs: 1.25
});

        const result = await checkMonitor({
            id: 1,
            url: 'https://example.com'
        });

expect(result).toEqual({
    status: 'UP',
    responseTime: 42,
    statusCode: 200
});

        expect(db.query).toHaveBeenCalledWith(
            expect.stringContaining('INSERT INTO monitor_results'),
            [
    1,
    'UP',
    42,
    200,
    null,
    null,
    5.5,
    8.25,
    12.75,
    30.5,
    1.25
]
        );
    });

    test('stores BAD_STATUS for an HTTP 503 response', async () => {
        checkHttp.mockResolvedValue({
            statusCode: 503,
            responseTimeMs: 75
        });

        await checkMonitor({ id: 2, url: 'https://example.com' });

        expect(db.query).toHaveBeenCalledWith(
            expect.stringContaining('INSERT INTO monitor_results'),
            [
                2,
                'DOWN',
                75,
                503,
                'BAD_STATUS',
                'Monitor returned HTTP 503'
            ]
        );
    });

    test('stores classified network failures', async () => {
        checkHttp.mockRejectedValue({
            code: 'ECONNREFUSED'
        });

        classifyCheckError.mockReturnValue({
            errorType: 'CONNECTION_REFUSED',
            errorMessage: 'The target server refused the connection'
        });

        const result = await checkMonitor({
            id: 3,
            url: 'https://example.com'
        });

        expect(result).toEqual({
            status: 'DOWN',
            responseTime: null,
            statusCode: null
        });

        expect(db.query).toHaveBeenCalledWith(
            expect.stringContaining('INSERT INTO monitor_results'),
            [
                3,
                'DOWN',
                null,
                null,
                'CONNECTION_REFUSED',
                'The target server refused the connection'
            ]
        );
    });

    test('records an outage event only on a transition to DOWN', async () => {
        checkHttp.mockResolvedValue({
            statusCode: 503,
            responseTimeMs: 30
        });

        db.query.mockResolvedValueOnce({
            rows: [{ status: 'UP' }]
        });

        await checkMonitor({ id: 4, url: 'https://example.com' });

        expect(db.query).toHaveBeenCalledWith(
            expect.stringContaining('INSERT INTO monitor_events'),
            [4, 'DOWN', 'Service is down']
        );
    });

        test('records a recovery event when status changes from DOWN to UP', async () => {
        checkHttp.mockResolvedValue({
            statusCode: 200,
            responseTimeMs: 25
        });

        db.query.mockResolvedValueOnce({
            rows: [{ status: 'DOWN' }]
        });

        await checkMonitor({ id: 6, url: 'https://example.com' });

        expect(db.query).toHaveBeenCalledWith(
            expect.stringContaining('INSERT INTO monitor_events'),
            [6, 'UP', 'Service recovered', 25]
        );
    });

    test('does not record another outage event when already DOWN', async () => {
        checkHttp.mockResolvedValue({
            statusCode: 503,
            responseTimeMs: 30
        });

        db.query.mockResolvedValueOnce({
            rows: [{ status: 'DOWN' }]
        });

        await checkMonitor({ id: 7, url: 'https://example.com' });

        expect(db.query).not.toHaveBeenCalledWith(
            expect.stringContaining('INSERT INTO monitor_events'),
            expect.anything()
        );
    });
    test('does not classify database errors as network failures', async () => {
        checkHttp.mockResolvedValue({
            statusCode: 200,
            responseTimeMs: 20
        });

        db.query.mockRejectedValueOnce(
            new Error('Database unavailable')
        );

        await expect(
            checkMonitor({ id: 5, url: 'https://example.com' })
        ).rejects.toThrow('Database unavailable');

        expect(classifyCheckError).not.toHaveBeenCalled();
    });

        test('records no events and sends no alerts during maintenance', async () => {
        checkHttp.mockResolvedValue({
            statusCode: 503,
            responseTimeMs: 30
        });

        db.query
            .mockResolvedValueOnce({ rows: [{ status: 'UP' }] })
            .mockResolvedValueOnce({ rows: [{ in_maintenance: true }] });

        await checkMonitor({
            id: 9,
            url: 'https://example.com',
            user_id: 1
        });

        expect(db.query).not.toHaveBeenCalledWith(
            expect.stringContaining('INSERT INTO monitor_events'),
            expect.anything()
        );

        expect(db.query).not.toHaveBeenCalledWith(
            expect.stringContaining('monitor_alert_state'),
            expect.anything()
        );
    });
    
});
