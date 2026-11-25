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
const { MAX_RULES_PER_USER } = require('../src/middleware/alertRuleLimit.middleware');

async function registerHost(user, name) {
    const response = await request(app)
        .post('/api/hosts/register')
        .set(authHeader(user.token))
        .send({ name });

    expect(response.status).toBe(201);

    return response.body.id;
}

// A user with one host and a single active CPU rule (> 80, duration 1).
async function setup() {
    const user = await createUser();
    const hostId = await registerHost(user, `host-${Math.random()}`);

    await pool.query('UPDATE alert_rules SET is_active = false');

    const created = await request(app)
        .post('/api/alert-rules')
        .set(authHeader(user.token))
        .send({ metric_name: 'cpu_usage', operator: '>', threshold: 80, duration: 1 });

    expect(created.status).toBe(201);

    return { user, hostId, ruleId: created.body.id };
}

const putRule = (user, ruleId, body) =>
    request(app)
        .put(`/api/alert-rules/${ruleId}`)
        .set(authHeader(user.token))
        .send(body);

const cpu = (hostId, value) => evaluateAlerts({ host_id: hostId, cpu_usage: value });
const sentTypes = () => notifyUser.mock.calls.map(call => call[1].type);

async function stateRows(ruleId) {
    const result = await pool.query(
        'SELECT host_id, is_breaching FROM alert_rule_states WHERE rule_id = $1',
        [ruleId]
    );

    return result.rows;
}

afterAll(async () => {
    await pool.end();
});

beforeEach(async () => {
    await resetDb();
    notifyUser.mockClear();
});

describe('breach state when a rule is edited', () => {
    test('disabling and re-enabling does not send a stale recovery message', async () => {
        const { user, hostId, ruleId } = await setup();

        await cpu(hostId, 95);
        expect(sentTypes()).toEqual(['HOST_METRIC_ALERT']);

        await putRule(user, ruleId, { is_active: false });
        await cpu(hostId, 40);
        await putRule(user, ruleId, { is_active: true });
        await cpu(hostId, 40);

        expect(sentTypes()).toEqual(['HOST_METRIC_ALERT']);
    });

    test('a re-enabled rule alerts again if the host is still breaching', async () => {
        const { user, hostId, ruleId } = await setup();

        await cpu(hostId, 95);
        await putRule(user, ruleId, { is_active: false });
        await putRule(user, ruleId, { is_active: true });
        await cpu(hostId, 96);

        expect(sentTypes()).toEqual(['HOST_METRIC_ALERT', 'HOST_METRIC_ALERT']);
    });

    test('saving the same values again keeps the state and sends nothing new', async () => {
        const { user, hostId, ruleId } = await setup();

        await cpu(hostId, 95);

        const response = await putRule(user, ruleId, {
            metric_name: 'cpu_usage',
            operator: '>',
            threshold: 80,
            duration: 1,
            is_active: true,
            host_id: null
        });

        expect(response.status).toBe(200);

        await cpu(hostId, 96);

        expect(sentTypes()).toEqual(['HOST_METRIC_ALERT']);
        expect(await stateRows(ruleId)).toHaveLength(1);
    });

    test('changing only the threshold keeps the state and does not send a duplicate alert', async () => {
        const { user, hostId, ruleId } = await setup();

        await cpu(hostId, 95);
        await putRule(user, ruleId, { threshold: 70 });
        await cpu(hostId, 96);

        expect(sentTypes()).toEqual(['HOST_METRIC_ALERT']);
    });

    test('moving a rule to another host clears the old host state', async () => {
        const { user, hostId, ruleId } = await setup();
        const otherHostId = await registerHost(user, `other-${Math.random()}`);

        await cpu(hostId, 95);
        expect(await stateRows(ruleId)).toHaveLength(1);

        const response = await putRule(user, ruleId, { host_id: otherHostId });

        expect(response.status).toBe(200);
        expect(await stateRows(ruleId)).toHaveLength(0);
    });

    test('a rule scoped to one host ignores samples from the user\'s other hosts', async () => {
        const { user, hostId, ruleId } = await setup();
        const otherHostId = await registerHost(user, `other-${Math.random()}`);

        await putRule(user, ruleId, { host_id: hostId });

        await cpu(otherHostId, 99);
        expect(sentTypes()).toEqual([]);

        await cpu(hostId, 99);
        expect(sentTypes()).toEqual(['HOST_METRIC_ALERT']);
    });
});

describe('alert rule limit per user', () => {
    const createRule = (user) =>
        request(app)
            .post('/api/alert-rules')
            .set(authHeader(user.token))
            .send({ metric_name: 'cpu_usage', operator: '>', threshold: 75 });

    async function fillToLimit(userEmail) {
        const owner = await pool.query('SELECT id FROM users WHERE email = $1', [userEmail]);
        const userId = owner.rows[0].id;

        await pool.query(
            `INSERT INTO alert_rules (metric_name, operator, threshold, duration, user_id)
             SELECT 'cpu_usage', '>', 50, 1, $1
             FROM generate_series(1, $2::int - (SELECT COUNT(*)::int FROM alert_rules WHERE user_id = $1))`,
            [userId, MAX_RULES_PER_USER]
        );
    }

    test('the limit is 100 rules per user', () => {
        expect(MAX_RULES_PER_USER).toBe(100);
    });

    test('creating a rule beyond the limit is refused with 409', async () => {
        const user = await createUser();
        await fillToLimit(user.email);

        const response = await createRule(user);

        expect(response.status).toBe(409);
        expect(response.body.error).toMatch(/limit/i);

        const count = await pool.query(
            'SELECT COUNT(*)::int AS count FROM alert_rules WHERE user_id = (SELECT id FROM users WHERE email = $1)',
            [user.email]
        );

        expect(count.rows[0].count).toBe(MAX_RULES_PER_USER);
    });

    test('deleting a rule makes room for a new one', async () => {
        const user = await createUser();
        await fillToLimit(user.email);

        const list = await request(app)
            .get('/api/alert-rules')
            .set(authHeader(user.token));

        const removed = await request(app)
            .delete(`/api/alert-rules/${list.body[0].id}`)
            .set(authHeader(user.token));

        expect(removed.status).toBe(200);
        expect((await createRule(user)).status).toBe(201);
    });

    test('one user reaching the limit does not block another user', async () => {
        const full = await createUser();
        const other = await createUser();
        await fillToLimit(full.email);

        expect((await createRule(full)).status).toBe(409);
        expect((await createRule(other)).status).toBe(201);
    });
});