const {
    pool,
    request,
    app,
    resetDb,
    createUser,
    authHeader
} = require('./helpers');

const { runApmAlertCheck } = require('../src/services/apmAlert.service');

async function registerHost(token, name) {
    const response = await request(app)
        .post('/api/hosts/register')
        .set(authHeader(token))
        .send({ name });

    expect(response.status).toBe(201);
    return response.body;
}

async function insertTraces(hostId, count, { status = 200, duration = 100 } = {}) {
    await pool.query(
        `INSERT INTO traces (host_id, method, route, status_code, duration_ms, timestamp)
         SELECT $1, 'GET', '/api/x', $2, $3, NOW() - INTERVAL '30 seconds'
         FROM generate_series(1, $4::int)`,
        [hostId, status, duration, count]
    );
}

async function getApmAlerts(hostId) {
    const result = await pool.query(
        `SELECT metric_name, metric_value, average_value, severity
         FROM alerts
         WHERE host_id = $1 AND metric_name LIKE 'apm\\_%'
         ORDER BY id`,
        [hostId]
    );

    return result.rows.map((row) => ({
        ...row,
        metric_value: Number(row.metric_value),
        average_value: Number(row.average_value)
    }));
}

async function getRuleState(hostId, metricName) {
    const result = await pool.query(
        `SELECT s.is_breaching, s.consecutive_breaches
         FROM alert_rule_states s
         JOIN alert_rules r ON r.id = s.rule_id
         WHERE s.host_id = $1 AND r.metric_name = $2`,
        [hostId, metricName]
    );

    return result.rows[0];
}

let user;

beforeAll(async () => {
    await resetDb();

    user = await createUser();

    // Registration seeds the default rules (including the two APM ones).
    // Fire on the first breaching evaluation so each test is a single run.
    await pool.query(
        `UPDATE alert_rules
         SET duration = 1
         WHERE metric_name LIKE 'apm\\_%'
           AND user_id = (SELECT id FROM users ORDER BY id DESC LIMIT 1)`
    );
});

afterAll(async () => {
    await pool.end();
});

test('new users get default APM alert rules', async () => {
    const result = await pool.query(
        `SELECT metric_name, operator
         FROM alert_rules
         WHERE metric_name LIKE 'apm\\_%'
         ORDER BY metric_name`
    );

    expect(result.rows).toEqual([
        { metric_name: 'apm_error_rate', operator: '>' },
        { metric_name: 'apm_p95_ms', operator: '>' }
    ]);
});

test('a high 5xx rate raises one Critical error-rate alert', async () => {
    const host = await registerHost(user.token, 'apm-alert-errors');

    await insertTraces(host.id, 18, { status: 200 });
    await insertTraces(host.id, 12, { status: 500 });

    await runApmAlertCheck();

    const alerts = await getApmAlerts(host.id);

    expect(alerts).toHaveLength(1);
    expect(alerts[0].metric_name).toBe('apm_error_rate');
    expect(alerts[0].metric_value).toBe(40);
    expect(alerts[0].average_value).toBe(5);
    expect(alerts[0].severity).toBe('Critical');

    // Still breaching on the next run: no duplicate alert.
    await runApmAlertCheck();

    expect(await getApmAlerts(host.id)).toHaveLength(1);
    expect((await getRuleState(host.id, 'apm_error_rate')).is_breaching).toBe(true);
});

test('4xx responses do not count towards the error rate', async () => {
    const host = await registerHost(user.token, 'apm-alert-4xx');

    await insertTraces(host.id, 30, { status: 404 });

    await runApmAlertCheck();

    expect(await getApmAlerts(host.id)).toEqual([]);
});

test('high p95 latency raises a Critical latency alert', async () => {
    const host = await registerHost(user.token, 'apm-alert-latency');

    await insertTraces(host.id, 30, { status: 200, duration: 6000 });

    await runApmAlertCheck();

    const alerts = await getApmAlerts(host.id);

    expect(alerts).toHaveLength(1);
    expect(alerts[0].metric_name).toBe('apm_p95_ms');
    expect(alerts[0].metric_value).toBe(6000);
    expect(alerts[0].severity).toBe('Critical');
});

test('a host below the minimum request count is not evaluated', async () => {
    const host = await registerHost(user.token, 'apm-alert-quiet');

    await insertTraces(host.id, 5, { status: 500, duration: 9000 });

    await runApmAlertCheck();

    expect(await getApmAlerts(host.id)).toEqual([]);
    const state = await getRuleState(host.id, 'apm_error_rate');
    expect(state.is_breaching).toBe(false);
    expect(state.consecutive_breaches).toBe(0);
});

test('traces outside the window are ignored', async () => {
    const host = await registerHost(user.token, 'apm-alert-stale');

    await pool.query(
        `INSERT INTO traces (host_id, method, route, status_code, duration_ms, timestamp)
         SELECT $1, 'GET', '/api/x', 500, 9000, NOW() - INTERVAL '1 hour'
         FROM generate_series(1, 30)`,
        [host.id]
    );

    await runApmAlertCheck();

    expect(await getApmAlerts(host.id)).toEqual([]);
});

test('recovery clears the breach so the next incident alerts again', async () => {
    const host = await registerHost(user.token, 'apm-alert-recovery');

    await insertTraces(host.id, 30, { status: 500 });
    await runApmAlertCheck();

    expect(await getApmAlerts(host.id)).toHaveLength(1);

    // Healthy traffic replaces the failing traffic.
    await pool.query('DELETE FROM traces WHERE host_id = $1', [host.id]);
    await insertTraces(host.id, 30, { status: 200 });
    await runApmAlertCheck();

    expect((await getRuleState(host.id, 'apm_error_rate')).is_breaching).toBe(false);

    // A new incident.
    await pool.query('DELETE FROM traces WHERE host_id = $1', [host.id]);
    await insertTraces(host.id, 30, { status: 500 });
    await runApmAlertCheck();

    expect(await getApmAlerts(host.id)).toHaveLength(2);
});

test('the rule duration is counted in evaluations', async () => {
    const host = await registerHost(user.token, 'apm-alert-duration');

    await pool.query(
        `UPDATE alert_rules SET duration = 3
         WHERE metric_name = 'apm_error_rate'
           AND user_id = (SELECT user_id FROM hosts WHERE id = $1)`,
        [host.id]
    );

    await insertTraces(host.id, 30, { status: 500 });

    await runApmAlertCheck();
    await runApmAlertCheck();

    expect(await getApmAlerts(host.id)).toEqual([]);
    expect((await getRuleState(host.id, 'apm_error_rate')).consecutive_breaches).toBe(2);

    await runApmAlertCheck();

    expect(await getApmAlerts(host.id)).toHaveLength(1);
});

test('a deactivated rule produces no alert', async () => {
    const other = await createUser();
    const host = await registerHost(other.token, 'apm-alert-disabled');

    await pool.query(
        `UPDATE alert_rules SET is_active = false, duration = 1
         WHERE metric_name LIKE 'apm\\_%'
           AND user_id = (SELECT user_id FROM hosts WHERE id = $1)`,
        [host.id]
    );

    await insertTraces(host.id, 30, { status: 500, duration: 9000 });

    await runApmAlertCheck();

    expect(await getApmAlerts(host.id)).toEqual([]);
});
