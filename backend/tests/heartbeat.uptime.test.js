jest.mock('../src/config/db', () => ({
    query: jest.fn()
}));

jest.mock('../src/services/httpCheck.service', () => ({
    checkHttp: jest.fn()
}));

jest.mock('../src/services/tcpCheck.service', () => ({
    checkTcp: jest.fn()
}));

jest.mock('../src/services/dnsCheck.service', () => ({
    checkDns: jest.fn()
}));

jest.mock('../src/services/checkError.service', () => ({
    classifyCheckError: jest.fn(error => ({
        errorType: 'CHECK_ERROR',
        errorMessage: error.message
    }))
}));

jest.mock('../src/services/monitorAlert.service', () => ({
    processCheckOutcome: jest.fn()
}));

jest.mock('../src/services/monitorCertificateAlert.service', () => ({
    processCertificateAlert: jest.fn()
}));

jest.mock('../src/services/monitorQuorum.service', () => ({
    evaluateMonitorQuorum: jest.fn(async (monitor, result) => result)
}));

const db = require('../src/config/db');
const { checkMonitor } = require('../src/services/uptime.service');
const { processCheckOutcome } = require('../src/services/monitorAlert.service');
const { evaluateMonitorQuorum } = require('../src/services/monitorQuorum.service');

const monitor = (id, createdAgoMs, lastSeenAt = null) => ({
    id,
    monitor_type: 'HEARTBEAT',
    created_at: new Date(Date.now() - createdAgoMs).toISOString(),
    interval_seconds: 30,
    heartbeat_grace_seconds: 60,
    failure_threshold: 1,
    lastSeenAt
});

function setupPersistence({ previousStatus = 'UP', confirmedStatus = 'UP', failures = 0 } = {}) {
    db.query.mockImplementation(async (sql) => {
        if (sql.includes('FROM heartbeat_monitor_secrets')) {
            return { rows: [{ last_seen_at: currentLastSeenAt }] };
        }

        if (sql.includes('SELECT status') && sql.includes('FROM monitor_results')) {
            return { rows: [{ status: previousStatus }] };
        }

        if (sql.includes('INSERT INTO monitor_results')) {
            return { rows: [{ in_maintenance: false }] };
        }

        if (sql.includes('SELECT confirmed_status, consecutive_failures')) {
            return {
                rows: [{
                    confirmed_status: confirmedStatus,
                    consecutive_failures: failures
                }]
            };
        }

        return { rows: [] };
    });
}

let currentLastSeenAt;

beforeEach(() => {
    jest.clearAllMocks();
    currentLastSeenAt = null;
});

test('does not record a first heartbeat before its deadline', async () => {
    currentLastSeenAt = null;
    db.query.mockResolvedValueOnce({ rows: [{ last_seen_at: null }] });

    const result = await checkMonitor(monitor(801, 10000));

    expect(result).toBeNull();
    expect(evaluateMonitorQuorum).not.toHaveBeenCalled();
    expect(db.query).toHaveBeenCalledTimes(1);
    expect(processCheckOutcome).not.toHaveBeenCalled();
});

test('marks a heartbeat monitor DOWN after the interval and grace expire', async () => {
    currentLastSeenAt = null;
    setupPersistence({ previousStatus: 'UP', confirmedStatus: 'UP', failures: 0 });

    const result = await checkMonitor(monitor(802, 95000));

    expect(result).toMatchObject({ status: 'DOWN' });
    expect(db.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO monitor_results'),
        expect.arrayContaining([802, 'DOWN', null, null, 'HEARTBEAT_MISSED'])
    );
    expect(db.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO monitor_events'),
        [802, 'DOWN', 'Service is down']
    );
    expect(processCheckOutcome).toHaveBeenCalledWith(
        expect.objectContaining({ id: 802 }),
        expect.objectContaining({ status: 'DOWN' }),
        'DOWN'
    );
});

test('records UP and emits recovery after a heartbeat resumes', async () => {
    currentLastSeenAt = new Date(Date.now() - 20000).toISOString();
    setupPersistence({ previousStatus: 'DOWN', confirmedStatus: 'DOWN', failures: 2 });

    const result = await checkMonitor(monitor(803, 120000));

    expect(result).toMatchObject({ status: 'UP' });
    expect(db.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO monitor_events'),
        [803, 'UP', 'Service recovered', null]
    );
    expect(processCheckOutcome).toHaveBeenCalledWith(
        expect.objectContaining({ id: 803 }),
        expect.objectContaining({ status: 'UP' }),
        'UP'
    );
});
