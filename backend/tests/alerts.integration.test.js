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


describe('alert rule CRUD API', () => {
    async function createRule(token, overrides = {}) {
        return request(app)
            .post('/api/alert-rules')
            .set(authHeader(token))
            .send({
                metric_name: 'cpu_usage',
                operator: '>',
                threshold: 80,
                ...overrides
            });
    }

    test('creates both global and host-specific rules', async () => {
        const user = await createUser();
        const host = await registerHost(user.token, 'crud-scoped-host');

        const globalResponse = await createRule(user.token);

        const scopedResponse = await createRule(user.token, {
            metric_name: 'memory_usage',
            operator: '>=',
            threshold: 85,
            duration: 3,
            is_active: false,
            host_id: host.id
        });

        expect(globalResponse.status).toBe(201);
        expect(globalResponse.body.metric_name).toBe('cpu_usage');
        expect(globalResponse.body.host_id).toBeNull();

        expect(scopedResponse.status).toBe(201);
        expect(scopedResponse.body.metric_name).toBe('memory_usage');
        expect(scopedResponse.body.operator).toBe('>=');
        expect(Number(scopedResponse.body.threshold)).toBe(85);
        expect(scopedResponse.body.duration).toBe(3);
        expect(scopedResponse.body.is_active).toBe(false);
        expect(scopedResponse.body.host_id).toBe(host.id);
    });

    test('updates rule fields and supports switching between global and host scope', async () => {
        const user = await createUser();
        const host = await registerHost(user.token, 'crud-update-host');

        const created = await createRule(user.token);
        expect(created.status).toBe(201);

        const scopedUpdate = await request(app)
            .put(`/api/alert-rules/${created.body.id}`)
            .set(authHeader(user.token))
            .send({
                metric_name: 'memory_usage',
                operator: '<=',
                threshold: 70,
                duration: 5,
                is_active: false,
                host_id: host.id
            });

        expect(scopedUpdate.status).toBe(200);
        expect(scopedUpdate.body.metric_name).toBe('memory_usage');
        expect(scopedUpdate.body.operator).toBe('<=');
        expect(Number(scopedUpdate.body.threshold)).toBe(70);
        expect(scopedUpdate.body.duration).toBe(5);
        expect(scopedUpdate.body.is_active).toBe(false);
        expect(scopedUpdate.body.host_id).toBe(host.id);

        const globalUpdate = await request(app)
            .put(`/api/alert-rules/${created.body.id}`)
            .set(authHeader(user.token))
            .send({ host_id: null });

        expect(globalUpdate.status).toBe(200);
        expect(globalUpdate.body.host_id).toBeNull();
    });

    test('rejects a partial percentage threshold update above 100', async () => {
        const user = await createUser();
        const created = await createRule(user.token);

        const update = await request(app)
            .put(`/api/alert-rules/${created.body.id}`)
            .set(authHeader(user.token))
            .send({ threshold: 101 });

        expect(update.status).toBe(400);

        const rules = await request(app)
            .get('/api/alert-rules')
            .set(authHeader(user.token));

        const storedRule = rules.body.find(
            rule => rule.id === created.body.id
        );

        expect(Number(storedRule.threshold)).toBe(80);
    });

    test('rejects changing a network rule to a percentage metric with an excessive existing threshold', async () => {
        const user = await createUser();
        const created = await createRule(user.token, {
            metric_name: 'network_in',
            threshold: 150
        });

        expect(created.status).toBe(201);

        const update = await request(app)
            .put(`/api/alert-rules/${created.body.id}`)
            .set(authHeader(user.token))
            .send({ metric_name: 'cpu_usage' });

        expect(update.status).toBe(400);

        const rules = await request(app)
            .get('/api/alert-rules')
            .set(authHeader(user.token));

        const storedRule = rules.body.find(
            rule => rule.id === created.body.id
        );

        expect(storedRule.metric_name).toBe('network_in');
        expect(Number(storedRule.threshold)).toBe(150);
    });
    test('deletes an owned alert rule', async () => {
        const user = await createUser();
        const created = await createRule(user.token);

        expect(created.status).toBe(201);

        const deleted = await request(app)
            .delete(`/api/alert-rules/${created.body.id}`)
            .set(authHeader(user.token));

        expect(deleted.status).toBe(200);
        expect(deleted.body.message).toBe('Alert rule deleted');
        expect(deleted.body.id).toBe(created.body.id);

        const rules = await request(app)
            .get('/api/alert-rules')
            .set(authHeader(user.token));

        expect(rules.status).toBe(200);
        expect(rules.body.some(rule => rule.id === created.body.id)).toBe(false);
    });

    test.each([
        ['unsupported metric', { metric_name: 'temperature' }],
        ['unsupported operator', { operator: '==' }],
        ['non-numeric threshold', { threshold: 'high' }],
        ['negative threshold', { threshold: -1 }],
        ['percentage threshold above 100', { metric_name: 'cpu_usage', threshold: 101 }],
        ['invalid duration', { duration: 0 }],
        ['invalid host ID', { host_id: -1 }],
        ['unsupported field', { user_id: 999 }]
    ])('rejects creation with %s', async (_description, overrides) => {
        const user = await createUser();

        const response = await createRule(user.token, overrides);

        expect(response.status).toBe(400);
    });

    test('rejects empty updates and invalid rule IDs', async () => {
        const user = await createUser();
        const created = await createRule(user.token);

        const emptyUpdate = await request(app)
            .put(`/api/alert-rules/${created.body.id}`)
            .set(authHeader(user.token))
            .send({});

        const invalidUpdate = await request(app)
            .put('/api/alert-rules/not-a-number')
            .set(authHeader(user.token))
            .send({ threshold: 90 });

        const invalidDelete = await request(app)
            .delete('/api/alert-rules/0')
            .set(authHeader(user.token));

        expect(emptyUpdate.status).toBe(400);
        expect(invalidUpdate.status).toBe(400);
        expect(invalidDelete.status).toBe(400);
    });

    test('prevents users from modifying or deleting another user rules', async () => {
        const owner = await createUser();
        const otherUser = await createUser();

        const created = await createRule(owner.token);

        const update = await request(app)
            .put(`/api/alert-rules/${created.body.id}`)
            .set(authHeader(otherUser.token))
            .send({ threshold: 95 });

        const deletion = await request(app)
            .delete(`/api/alert-rules/${created.body.id}`)
            .set(authHeader(otherUser.token));

        expect(update.status).toBe(404);
        expect(deletion.status).toBe(404);

        const ownerRules = await request(app)
            .get('/api/alert-rules')
            .set(authHeader(owner.token));

        expect(ownerRules.body.some(rule => rule.id === created.body.id)).toBe(true);
    });

    test('prevents assigning a host owned by another user', async () => {
        const owner = await createUser();
        const otherUser = await createUser();

        const foreignHost = await registerHost(otherUser.token, 'crud-foreign-host');

        const createResponse = await createRule(owner.token, {
            host_id: foreignHost.id
        });

        expect(createResponse.status).toBe(404);

        const created = await createRule(owner.token);
        expect(created.status).toBe(201);

        const updateResponse = await request(app)
            .put(`/api/alert-rules/${created.body.id}`)
            .set(authHeader(owner.token))
            .send({ host_id: foreignHost.id });

        expect(updateResponse.status).toBe(404);
    });
});
