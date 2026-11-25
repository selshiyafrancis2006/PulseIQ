// Capture notifications instead of sending them.
jest.mock('../src/services/notification.service', () => ({
    ...jest.requireActual('../src/services/notification.service'),
    notifyUser: jest.fn().mockResolvedValue([])
}));

const {
    pool,
    resetDb,
    createUser,
    request,
    app,
    authHeader
} = require('./helpers');

const { notifyUser } = require('../src/services/notification.service');
const { evaluateAlerts } = require('../src/services/alert.service');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Notifications are sent after evaluateAlerts returns, so wait for them.
async function waitForCalls(count, timeoutMs = 3000) {
    const deadline = Date.now() + timeoutMs;

    while (notifyUser.mock.calls.length < count && Date.now() < deadline) {
        await sleep(25);
    }
}

async function createHostWithCpuRule() {
    const user = await createUser();
    const hostName = `metric-notify-${Date.now()}-${Math.round(Math.random() * 1e6)}`;

    const response = await request(app)
        .post('/api/hosts/register')
        .set(authHeader(user.token))
        .send({ name: hostName });

    expect(response.status).toBe(201);

    const hostId = response.body.id;
    const owner = await pool.query(
        'SELECT user_id FROM hosts WHERE id = $1',
        [hostId]
    );
    const userId = owner.rows[0].user_id;

    // Only the rule under test stays active.
    await pool.query(
        'UPDATE alert_rules SET is_active = false WHERE user_id = $1',
        [userId]
    );

    await pool.query(
        `INSERT INTO alert_rules
            (metric_name, operator, threshold, duration, is_active, user_id)
         VALUES ('cpu_usage', '>', 80, 1, true, $1)`,
        [userId]
    );

    return { hostId, hostName, userId };
}

const cpu = (hostId, value) => ({ host_id: hostId, cpu_usage: value });

async function countAlerts(hostId) {
    const result = await pool.query(
        'SELECT COUNT(*)::int AS count FROM alerts WHERE host_id = $1',
        [hostId]
    );

    return result.rows[0].count;
}

async function addWindow(userId, startsOffset, endsOffset) {
    await pool.query(
        `INSERT INTO maintenance_windows (user_id, monitor_id, reason, starts_at, ends_at)
         VALUES ($1, NULL, 'test window',
                 NOW() + $2::interval, NOW() + $3::interval)`,
        [userId, startsOffset, endsOffset]
    );
}

beforeEach(async () => {
    await resetDb();
    notifyUser.mockClear();
    notifyUser.mockResolvedValue([]);
});

// Let any background notification work finish before the next test.
afterEach(async () => {
    await sleep(150);
});

afterAll(async () => {
    await pool.end();
});

test('a triggered alert sends one METRIC_ALERT notification', async () => {
    const { hostId, hostName, userId } = await createHostWithCpuRule();

    await evaluateAlerts(cpu(hostId, 95));
    await waitForCalls(1);

    expect(notifyUser).toHaveBeenCalledTimes(1);

    const [calledUserId, event] = notifyUser.mock.calls[0];

    expect(calledUserId).toBe(userId);
    expect(event).toMatchObject({
        type: 'HOST_METRIC_ALERT',
        host: { id: hostId, name: hostName },
        metricName: 'cpu_usage',
        metricLabel: 'CPU usage',
        severity: 'Critical',
        operator: '>',
        value: 95,
        threshold: 80,
        valueText: '95%',
        thresholdText: '80%'
    });
});

test('no further notification is sent while the alert stays active', async () => {
    const { hostId } = await createHostWithCpuRule();

    await evaluateAlerts(cpu(hostId, 95));
    await waitForCalls(1);
    await evaluateAlerts(cpu(hostId, 96));
    await evaluateAlerts(cpu(hostId, 97));
    await sleep(300);

    expect(notifyUser).toHaveBeenCalledTimes(1);
});

test('recovery sends one METRIC_RECOVERED notification', async () => {
    const { hostId } = await createHostWithCpuRule();

    await evaluateAlerts(cpu(hostId, 95));
    await waitForCalls(1);

    await evaluateAlerts(cpu(hostId, 40));
    await waitForCalls(2);

    expect(notifyUser).toHaveBeenCalledTimes(2);
    expect(notifyUser.mock.calls[1][1]).toMatchObject({
        type: 'HOST_METRIC_RECOVERED',
        metricName: 'cpu_usage',
        severity: null,
        value: 40,
        valueText: '40%'
    });

    // Staying normal afterwards sends nothing more.
    await evaluateAlerts(cpu(hostId, 41));
    await sleep(300);

    expect(notifyUser).toHaveBeenCalledTimes(2);
});

test('a normal sample that never breached sends nothing', async () => {
    const { hostId } = await createHostWithCpuRule();

    await evaluateAlerts(cpu(hostId, 20));
    await evaluateAlerts(cpu(hostId, 30));
    await sleep(300);

    expect(notifyUser).not.toHaveBeenCalled();
    expect(await countAlerts(hostId)).toBe(0);
});

test('an active maintenance window mutes the notification but still saves the alert', async () => {
    const { hostId, userId } = await createHostWithCpuRule();

    await addWindow(userId, '-1 hour', '1 hour');

    await evaluateAlerts(cpu(hostId, 95));
    await sleep(400);

    expect(notifyUser).not.toHaveBeenCalled();
    expect(await countAlerts(hostId)).toBe(1);
});

test('an ended maintenance window does not mute notifications', async () => {
    const { hostId, userId } = await createHostWithCpuRule();

    await addWindow(userId, '-2 hours', '-1 hour');

    await evaluateAlerts(cpu(hostId, 95));
    await waitForCalls(1);

    expect(notifyUser).toHaveBeenCalledTimes(1);
});

test('a failing notification does not break alert evaluation', async () => {
    const { hostId } = await createHostWithCpuRule();

    notifyUser.mockRejectedValueOnce(new Error('channel exploded'));

    await expect(evaluateAlerts(cpu(hostId, 95))).resolves.toBeUndefined();
    await waitForCalls(1);

    expect(await countAlerts(hostId)).toBe(1);

    // The state still moved on, so recovery is detected normally.
    await evaluateAlerts(cpu(hostId, 40));
    await waitForCalls(2);

    expect(notifyUser.mock.calls[1][1].type).toBe('HOST_METRIC_RECOVERED');
});