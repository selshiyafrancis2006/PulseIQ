jest.mock('../src/services/notification.service', () => {
    const actual = jest.requireActual('../src/services/notification.service');

    return {
        ...actual,
        notifyUser: jest.fn().mockResolvedValue([])
    };
});

const {
    pool,
    resetDb,
    createUser,
    request,
    app,
    authHeader
} = require('./helpers');

const {
    notifyUser,
    buildSlackPayload,
    buildWebhookPayload,
    buildEmailMessage
} = require('../src/services/notification.service');

const { evaluateAlerts } = require('../src/services/alert.service');

const {
    HOST_METRIC_ALERT,
    HOST_METRIC_RECOVERED,
    buildHostMetricEvent
} = require('../src/services/hostMetricEvents');

async function createHostWithCpuRule(duration = 1) {
    const user = await createUser();

    const response = await request(app)
        .post('/api/hosts/register')
        .set(authHeader(user.token))
        .send({ name: `notify-${Date.now()}-${Math.random()}` });

    expect(response.status).toBe(201);

    const hostId = response.body.id;

    const owner = await pool.query(
        'SELECT user_id FROM hosts WHERE id = $1',
        [hostId]
    );
    const userId = owner.rows[0].user_id;

    // Only this test's rule should be active.
    await pool.query(
        'UPDATE alert_rules SET is_active = false WHERE user_id = $1',
        [userId]
    );

    await pool.query(
        `INSERT INTO alert_rules
            (metric_name, operator, threshold, duration, is_active, user_id)
         VALUES ('cpu_usage', '>', 80, $1, true, $2)`,
        [duration, userId]
    );

    return { hostId, userId, hostName: response.body.name };
}

const cpu = (hostId, value) => ({ host_id: hostId, cpu_usage: value });

const countAlerts = async (hostId) => {
    const result = await pool.query(
        'SELECT COUNT(*)::int AS count FROM alerts WHERE host_id = $1',
        [hostId]
    );

    return result.rows[0].count;
};

afterAll(async () => {
    await pool.end();
});

beforeEach(async () => {
    await resetDb();
    notifyUser.mockReset();
    notifyUser.mockResolvedValue([]);
});

describe('host metric notification payloads', () => {
    const rule = { metric_name: 'cpu_usage', operator: '>', threshold: 80 };
    const host = { id: 7, name: 'web <01> & co' };

    const alertEvent = buildHostMetricEvent({
        type: HOST_METRIC_ALERT,
        host,
        rule,
        value: 93.456,
        severity: 'Critical'
    });

    const recoveredEvent = buildHostMetricEvent({
        type: HOST_METRIC_RECOVERED,
        host,
        rule,
        value: 41
    });

    test('slack message names the host, metric, value and rule, and escapes the host name', () => {
        const { text } = buildSlackPayload(alertEvent);

        expect(text).toContain('web &lt;01&gt; &amp; co');
        expect(text).toContain('CPU usage alert (Critical)');
        expect(text).toContain('93.46%');
        expect(text).toContain('rule: &gt; 80%');
        expect(text).not.toContain('<01>');
    });

    test('slack recovery message is green and states the new value', () => {
        const { text } = buildSlackPayload(recoveredEvent);

        expect(text).toContain(':large_green_circle:');
        expect(text).toContain('recovered');
        expect(text).toContain('41%');
    });

    test('webhook payload is structured and tagged with the event type', () => {
        const payload = buildWebhookPayload(alertEvent);

        expect(payload).toMatchObject({
            source: 'pulseiq',
            event: 'HOST_METRIC_ALERT',
            host: { id: 7, name: 'web <01> & co' },
            metric: {
                name: 'cpu_usage',
                value: 93.456,
                threshold: 80,
                operator: '>'
            },
            severity: 'Critical'
        });
    });

    test('email has a host-specific subject and no monitor wording', () => {
        const alertMail = buildEmailMessage(alertEvent);
        const recoveredMail = buildEmailMessage(recoveredEvent);

        expect(alertMail.subject).toBe('[PulseIQ] Critical: CPU usage on web <01> & co');
        expect(alertMail.text).toContain('Host: web <01> & co');
        expect(alertMail.text).not.toContain('Monitor:');
        expect(recoveredMail.subject).toBe('[PulseIQ] Recovered: CPU usage on web <01> & co');
    });

    test('monitor events still use the original builders', () => {
        const { text } = buildSlackPayload({
            type: 'DOWN',
            monitor: { name: 'api', url: 'https://example.com' }
        });

        expect(text).toContain('*api* is DOWN');
    });
});

describe('host metric notifications from the alert engine', () => {
    test('sends one notification to the owner when an alert fires', async () => {
        const { hostId, userId, hostName } = await createHostWithCpuRule(1);

        await evaluateAlerts(cpu(hostId, 95));

        expect(await countAlerts(hostId)).toBe(1);
        expect(notifyUser).toHaveBeenCalledTimes(1);

        const [calledUserId, event] = notifyUser.mock.calls[0];

        expect(calledUserId).toBe(userId);
        expect(event).toMatchObject({
            type: HOST_METRIC_ALERT,
            host: { id: hostId, name: hostName },
            metricName: 'cpu_usage',
            severity: 'Critical'
        });
    });

    test('does not notify again while the breach continues', async () => {
        const { hostId } = await createHostWithCpuRule(1);

        await evaluateAlerts(cpu(hostId, 95));
        await evaluateAlerts(cpu(hostId, 96));
        await evaluateAlerts(cpu(hostId, 97));

        expect(notifyUser).toHaveBeenCalledTimes(1);
    });

    test('does not notify before the consecutive-breach duration is reached', async () => {
        const { hostId } = await createHostWithCpuRule(3);

        await evaluateAlerts(cpu(hostId, 95));
        await evaluateAlerts(cpu(hostId, 95));

        expect(notifyUser).not.toHaveBeenCalled();
    });

    test('sends exactly one recovery message after a notified breach', async () => {
        const { hostId } = await createHostWithCpuRule(1);

        await evaluateAlerts(cpu(hostId, 95));
        await evaluateAlerts(cpu(hostId, 40));
        await evaluateAlerts(cpu(hostId, 41));

        expect(notifyUser).toHaveBeenCalledTimes(2);
        expect(notifyUser.mock.calls[1][1]).toMatchObject({
            type: HOST_METRIC_RECOVERED,
            metricName: 'cpu_usage'
        });
    });

    test('sends no recovery message when no alert was ever announced', async () => {
        const { hostId } = await createHostWithCpuRule(3);

        await evaluateAlerts(cpu(hostId, 95));
        await evaluateAlerts(cpu(hostId, 40));

        expect(notifyUser).not.toHaveBeenCalled();
    });

    test('a failing notification does not lose the alert or throw', async () => {
        const { hostId } = await createHostWithCpuRule(1);

        notifyUser.mockRejectedValue(new Error('slack is down'));

        await expect(evaluateAlerts(cpu(hostId, 95))).resolves.toBeUndefined();

        expect(await countAlerts(hostId)).toBe(1);

        const state = await pool.query(
            'SELECT is_breaching FROM alert_rule_states WHERE host_id = $1',
            [hostId]
        );

        expect(state.rows[0].is_breaching).toBe(true);
    });
});