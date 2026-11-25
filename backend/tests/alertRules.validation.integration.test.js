const {
    pool,
    resetDb,
    createUser,
    request,
    app,
    authHeader
} = require('./helpers');

async function getRules(user) {
    const response = await request(app)
        .get('/api/alert-rules')
        .set(authHeader(user.token));

    expect(response.status).toBe(200);

    return response.body;
}

const putRule = (user, id, body) =>
    request(app)
        .put(`/api/alert-rules/${id}`)
        .set(authHeader(user.token))
        .send(body);

const cpuRule = (rules) => rules.find((rule) => rule.metric_name === 'cpu_usage');

beforeEach(async () => {
    await resetDb();
});

afterAll(async () => {
    await pool.end();
});

test('updates threshold and is_active together', async () => {
    const user = await createUser();
    const rule = cpuRule(await getRules(user));

    const response = await putRule(user, rule.id, {
        threshold: 90,
        is_active: false
    });

    expect(response.status).toBe(200);
    expect(response.body.threshold).toBe(90);
    expect(response.body.is_active).toBe(false);
});

test('sending only threshold keeps is_active unchanged', async () => {
    const user = await createUser();
    const rule = cpuRule(await getRules(user));

    const response = await putRule(user, rule.id, { threshold: 70 });

    expect(response.status).toBe(200);
    expect(response.body.threshold).toBe(70);
    expect(response.body.is_active).toBe(true);
});

test('sending only is_active keeps threshold unchanged', async () => {
    const user = await createUser();
    const rule = cpuRule(await getRules(user));

    const response = await putRule(user, rule.id, { is_active: false });

    expect(response.status).toBe(200);
    expect(response.body.is_active).toBe(false);
    expect(response.body.threshold).toBe(rule.threshold);
});

test('an empty body is rejected and nothing changes', async () => {
    const user = await createUser();
    const rule = cpuRule(await getRules(user));

    const response = await putRule(user, rule.id, {});

    expect(response.status).toBe(400);
    expect(cpuRule(await getRules(user))).toMatchObject({
        threshold: rule.threshold,
        is_active: true
    });
});

test.each([
    ['a string', '50'],
    ['null', null],
    ['a negative number', -1],
    ['above 100 for a percentage metric', 101],
    ['a boolean', true]
])('rejects a threshold that is %s', async (_description, badValue) => {
    const user = await createUser();
    const rule = cpuRule(await getRules(user));

    const response = await putRule(user, rule.id, { threshold: badValue });

    expect(response.status).toBe(400);
    expect(typeof response.body.error).toBe('string');
    expect(cpuRule(await getRules(user)).threshold).toBe(rule.threshold);
});

test.each([
    ['a string', 'yes'],
    ['null', null],
    ['a number', 1]
])('rejects is_active that is %s', async (_description, badValue) => {
    const user = await createUser();
    const rule = cpuRule(await getRules(user));

    const response = await putRule(user, rule.id, { is_active: badValue });

    expect(response.status).toBe(400);
    expect(cpuRule(await getRules(user)).is_active).toBe(true);
});

test('rejects unsupported update fields', async () => {
    const user = await createUser();
    const rule = cpuRule(await getRules(user));

    const response = await putRule(user, rule.id, {
        threshold: 50,
        unexpected_field: true
    });

    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/Unsupported alert rule field/);

    const after = cpuRule(await getRules(user));

    expect(after.threshold).toBe(rule.threshold);
    expect(after.operator).toBe(rule.operator);
});

test.each([
    ['non-numeric', 'abc'],
    ['zero', '0'],
    ['negative', '-1'],
    ['fractional', '1.5']
])('rejects a %s rule id', async (_description, badId) => {
    const user = await createUser();

    const response = await putRule(user, badId, { threshold: 50 });

    expect(response.status).toBe(400);
});

test('returns 404 for a rule that does not exist', async () => {
    const user = await createUser();

    const response = await putRule(user, 999999999, { threshold: 50 });

    expect(response.status).toBe(404);
});

test("returns 404 and changes nothing for another user's rule", async () => {
    const owner = await createUser();
    const other = await createUser();
    const rule = cpuRule(await getRules(owner));

    const response = await putRule(other, rule.id, { threshold: 10 });

    expect(response.status).toBe(404);
    expect(cpuRule(await getRules(owner)).threshold).toBe(rule.threshold);
});

test('a network rule accepts thresholds above 100', async () => {
    const user = await createUser();
    const owner = await pool.query('SELECT id FROM users WHERE email = $1', [user.email]);

    const inserted = await pool.query(
        `INSERT INTO alert_rules
            (metric_name, operator, threshold, duration, is_active, user_id)
         VALUES ('network_in', '>', 500, 1, true, $1)
         RETURNING id`,
        [owner.rows[0].id]
    );

    const response = await putRule(user, inserted.rows[0].id, { threshold: 5000 });

    expect(response.status).toBe(200);
    expect(response.body.threshold).toBe(5000);
});

test('requires authentication', async () => {
    const response = await request(app)
        .put('/api/alert-rules/1')
        .send({ threshold: 50 });

    expect(response.status).toBe(401);
});