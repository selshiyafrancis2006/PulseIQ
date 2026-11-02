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

test("a user cannot fetch another user's host alerts", async () => {
    const owner = await createUser();
    const otherUser = await createUser();
    const host = await registerHost(owner.token, 'private-alerts-host');
    await insertAlerts(host.id, 1);

    const response = await getAlerts(otherUser.token, host.id);

    // The host ownership filter returns no records for a non-owner.
    expect(response.status).toBe(200);
    expect(response.body).toEqual([]);
});

test('global alert history includes all owned hosts and excludes other users', async () => {
    const user = await createUser();
    const otherUser = await createUser();

    const firstHost = await registerHost(user.token, 'global-alerts-host-one');
    const secondHost = await registerHost(user.token, 'global-alerts-host-two');
    const otherHost = await registerHost(otherUser.token, 'global-alerts-other-user-host');

    await insertAlerts(firstHost.id, 1);
    await insertAlerts(secondHost.id, 1);
    await insertAlerts(otherHost.id, 1);

    const response = await request(app)
        .get('/api/alerts')
        .set(authHeader(user.token));

    expect(response.status).toBe(200);
    expect(response.body).toHaveLength(2);
    expect(response.body.map(alert => alert.host_id).sort((a, b) => a - b))
        .toEqual([firstHost.id, secondHost.id].sort((a, b) => a - b));
});

test('alerts allow global history and reject invalid host_id', async () => {
    const user = await createUser();

    const missing = await request(app)
        .get('/api/alerts')
        .set(authHeader(user.token));

    const invalid = await getAlerts(user.token, 'not-a-number');

    expect(missing.status).toBe(200);
    expect(invalid.status).toBe(400);
});

test('acknowledges an alert and preserves the original acknowledgement', async () => {
    const user = await createUser();
    const host = await registerHost(user.token, 'alert-acknowledgement-host');
    await insertAlerts(host.id, 1);

    const userResult = await pool.query(
        'SELECT id FROM users WHERE email = $1',
        [user.email]
    );
    const alertResult = await pool.query(
        'SELECT id FROM alerts WHERE host_id = $1 ORDER BY id DESC LIMIT 1',
        [host.id]
    );

    const userId = userResult.rows[0].id;
    const alertId = alertResult.rows[0].id;

    const firstResponse = await request(app)
        .post(`/api/alerts/${alertId}/acknowledge`)
        .set(authHeader(user.token));

    expect(firstResponse.status).toBe(200);
    expect(firstResponse.body.message).toBe('Alert acknowledged');
    expect(firstResponse.body.id).toBe(alertId);
    expect(firstResponse.body.acknowledged_at).toBeTruthy();
    expect(Number(firstResponse.body.acknowledged_by)).toBe(Number(userId));

    const originalTimestamp = firstResponse.body.acknowledged_at;

    const secondResponse = await request(app)
        .post(`/api/alerts/${alertId}/acknowledge`)
        .set(authHeader(user.token));

    expect(secondResponse.status).toBe(200);
    expect(secondResponse.body.acknowledged_at).toBe(originalTimestamp);
    expect(Number(secondResponse.body.acknowledged_by)).toBe(Number(userId));

    const fetchedAlerts = await getAlerts(user.token, host.id);
    const fetchedAlert = fetchedAlerts.body.find((alert) => alert.id === alertId);

    expect(fetchedAlert.acknowledged_at).toBe(originalTimestamp);
    expect(Number(fetchedAlert.acknowledged_by)).toBe(Number(userId));
});

test('a user cannot acknowledge another user’s alert', async () => {
    const owner = await createUser();
    const otherUser = await createUser();
    const host = await registerHost(owner.token, 'private-acknowledgement-host');
    await insertAlerts(host.id, 1);

    const alertResult = await pool.query(
        'SELECT id FROM alerts WHERE host_id = $1 ORDER BY id DESC LIMIT 1',
        [host.id]
    );

    const response = await request(app)
        .post(`/api/alerts/${alertResult.rows[0].id}/acknowledge`)
        .set(authHeader(otherUser.token));

    expect(response.status).toBe(404);
    expect(response.body.error).toBe('Alert not found');
});

test.each([
    ['non-numeric ID', 'abc'],
    ['zero ID', '0'],
    ['negative ID', '-1'],
    ['fractional ID', '1.5'],
    ['unsafe integer ID', '9007199254740992']
])('acknowledgement rejects %s', async (_description, alertId) => {
    const user = await createUser();

    const response = await request(app)
        .post(`/api/alerts/${alertId}/acknowledge`)
        .set(authHeader(user.token));

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('A valid alert id is required');
});

test('acknowledgement returns 404 for an alert that does not exist', async () => {
    const user = await createUser();

    const response = await request(app)
        .post('/api/alerts/999999999/acknowledge')
        .set(authHeader(user.token));

    expect(response.status).toBe(404);
    expect(response.body.error).toBe('Alert not found');
});
