const {
    app,
    pool,
    request,
    resetDb,
    createUser,
    authHeader
} = require('./helpers');

async function registerHost(token, name) {
    const response = await request(app)
        .post('/api/hosts/register')
        .set(authHeader(token))
        .send({ name });

    expect(response.status).toBe(201);
    return response.body;
}

async function insertAlerts(hostId, count) {
    for (let i = 0; i < count; i++) {
        await pool.query(
            `INSERT INTO alerts
                (metric_name, metric_value, average_value, severity, host_id, timestamp)
             VALUES ($1, $2, $3, $4, $5, NOW() - ($6 * INTERVAL '1 minute'))`,
            ['cpu_usage', 70 + i, 80, 'Warning', hostId, i]
        );
    }
}

function getAlerts(token, hostId, query = {}) {
    return request(app)
        .get('/api/alerts')
        .query({ host_id: hostId, ...query })
        .set(authHeader(token));
}

beforeAll(async () => {
    await resetDb();
});

afterAll(async () => {
    await pool.end();
});

test('alerts use the default limit of 20 and retain the existing response fields', async () => {
    const user = await createUser();
    const host = await registerHost(user.token, 'alerts-pagination-host');
    await insertAlerts(host.id, 25);

    const response = await getAlerts(user.token, host.id);

    expect(response.status).toBe(200);
    expect(response.body).toHaveLength(20);
    expect(response.body[0]).toHaveProperty('current_value');
    expect(response.body[0]).toHaveProperty('threshold_value');
    expect(response.body[0]).toHaveProperty('timestamp');
    expect(response.body[0].current_value).toBe(70);
});

test('alerts support custom limit and offset', async () => {
    const user = await createUser();
    const host = await registerHost(user.token, 'alerts-custom-page-host');
    await insertAlerts(host.id, 5);

    const firstPage = await getAlerts(user.token, host.id, {
        limit: 2,
        offset: 0
    });
    const secondPage = await getAlerts(user.token, host.id, {
        limit: 2,
        offset: 2
    });

    expect(firstPage.status).toBe(200);
    expect(secondPage.status).toBe(200);
    expect(firstPage.body).toHaveLength(2);
    expect(secondPage.body).toHaveLength(2);
    expect(firstPage.body.map((alert) => alert.id)).not.toEqual(
        secondPage.body.map((alert) => alert.id)
    );
});

test.each([
    ['zero limit', { limit: 0 }],
    ['limit above maximum', { limit: 101 }],
    ['fractional limit', { limit: 1.5 }],
    ['negative offset', { offset: -1 }],
    ['fractional offset', { offset: 1.5 }],
    ['non-numeric limit', { limit: 'abc' }]
])('alerts reject %s', async (_description, query) => {
    const user = await createUser();
    const host = await registerHost(user.token, 'alerts-invalid-query-host');

    const response = await getAlerts(user.token, host.id, query);

    expect(response.status).toBe(400);
});

test('a user cannot fetch another user’s host alerts', async () => {
    const owner = await createUser();
    const otherUser = await createUser();
    const host = await registerHost(owner.token, 'private-alerts-host');
    await insertAlerts(host.id, 1);

    const response = await getAlerts(otherUser.token, host.id);

    // The host ownership filter returns no records for a non-owner.
    expect(response.status).toBe(200);
    expect(response.body).toEqual([]);
});

test('alerts require a valid host_id', async () => {
    const user = await createUser();

    const missing = await request(app)
        .get('/api/alerts')
        .set(authHeader(user.token));

    const invalid = await getAlerts(user.token, 'not-a-number');

    expect(missing.status).toBe(400);
    expect(invalid.status).toBe(400);
});