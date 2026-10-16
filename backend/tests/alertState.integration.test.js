
const {
    pool,
    resetDb,
    createUser,
    request,
    app,
    authHeader
} = require('./helpers');

const { evaluateAlerts } = require('../src/services/alert.service');

async function createTestHostAndRule(duration = 2) {
    const user = await createUser();

    const response = await request(app)
        .post('/api/hosts/register')
        .set(authHeader(user.token))
        .send({ name: `alert-state-${Date.now()}-${Math.random()}` });

    expect(response.status).toBe(201);


const hostId = response.body.id;

// Disable default rules so this test exercises only its own rule.
await pool.query(
    `UPDATE alert_rules
     SET is_active = false
     WHERE user_id = (
         SELECT user_id FROM hosts WHERE id = $1
     )`,
    [hostId]
);

const ruleResult = await pool.query(

        `INSERT INTO alert_rules
            (metric_name, operator, threshold, duration, is_active, user_id)
         VALUES ('cpu_usage', '>', 80, $1, true, (
             SELECT user_id FROM hosts WHERE id = $2
         ))
         RETURNING id`,
        [duration, hostId]
    );

    return { hostId, ruleId: ruleResult.rows[0].id };
}

function cpuMetric(hostId, cpuUsage) {
    return {
        host_id: hostId,
        cpu_usage: cpuUsage
    };
}

async function countAlerts(hostId) {
    const result = await pool.query(
        'SELECT COUNT(*)::int AS count FROM alerts WHERE host_id = $1',
        [hostId]
    );

    return result.rows[0].count;
}

afterAll(async () => {
    await pool.end();
});

beforeEach(async () => {
    await resetDb();
});

test('alert fires only after the configured consecutive breach duration', async () => {
    const { hostId } = await createTestHostAndRule(2);

    await evaluateAlerts(cpuMetric(hostId, 90));

    expect(await countAlerts(hostId)).toBe(0);

    const firstState = await pool.query(
        `SELECT consecutive_breaches, is_breaching
         FROM alert_rule_states WHERE host_id = $1`,
        [hostId]
    );

    expect(firstState.rows[0].consecutive_breaches).toBe(1);
    expect(firstState.rows[0].is_breaching).toBe(false);

    await evaluateAlerts(cpuMetric(hostId, 91));

    expect(await countAlerts(hostId)).toBe(1);
});

test('an active breach does not create duplicate alerts on subsequent evaluations', async () => {
    const { hostId } = await createTestHostAndRule(1);

    await evaluateAlerts(cpuMetric(hostId, 95));

    expect(await countAlerts(hostId)).toBe(1);


    // Simulate a service-module reload. PostgreSQL state must
    // continue suppressing duplicate alerts without in-memory state.
    const servicePath = require.resolve('../src/services/alert.service');
    delete require.cache[servicePath];

    const { evaluateAlerts: evaluateAlertsAfterReload } =
        require('../src/services/alert.service');

    await evaluateAlertsAfterReload(cpuMetric(hostId, 96));
    await evaluateAlertsAfterReload(cpuMetric(hostId, 97));


    expect(await countAlerts(hostId)).toBe(1);

    const state = await pool.query(
        `SELECT consecutive_breaches, is_breaching
         FROM alert_rule_states WHERE host_id = $1`,
        [hostId]
    );

    expect(state.rows[0].is_breaching).toBe(true);
});

test('recovery resets the state and allows a new alert on a later breach', async () => {
    const { hostId } = await createTestHostAndRule(1);

    await evaluateAlerts(cpuMetric(hostId, 95));
    expect(await countAlerts(hostId)).toBe(1);

    await evaluateAlerts(cpuMetric(hostId, 50));

    const recoveredState = await pool.query(
        `SELECT consecutive_breaches, is_breaching
         FROM alert_rule_states WHERE host_id = $1`,
        [hostId]
    );

    expect(recoveredState.rows[0].consecutive_breaches).toBe(0);
    expect(recoveredState.rows[0].is_breaching).toBe(false);

    await evaluateAlerts(cpuMetric(hostId, 95));

    expect(await countAlerts(hostId)).toBe(2);
});
