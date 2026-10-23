const {
    app,
    pool,
    resetDb,
    createUser,
    authHeader,
    request
} = require('./helpers');

beforeAll(async () => {
    await resetDb();
});

afterAll(async () => {
    await pool.end();
});

async function createMonitor(token, name = 'crud-test-monitor') {
    const response = await request(app)
        .post('/api/monitors')
        .set(authHeader(token))
        .send({
            name,
            url: 'https://example.com',
            interval_seconds: 60,
            tags: ['env:test']
        });

    expect(response.status).toBe(201);
    return response.body;
}

test('owner can update monitor fields', async () => {
    const user = await createUser();
    const monitor = await createMonitor(user.token);

    const response = await request(app)
        .patch(`/api/monitors/${monitor.id}`)
        .set(authHeader(user.token))
        .send({
            name: 'updated-monitor',
            url: 'https://example.org',
            interval_seconds: 120,
            tags: ['env:prod']
        });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
        id: monitor.id,
        name: 'updated-monitor',
        url: 'https://example.org',
        interval_seconds: 120,
        tags: ['env:prod']
    });
});

test('monitor update rejects an invalid interval', async () => {
    const user = await createUser();
    const monitor = await createMonitor(user.token);

    const response = await request(app)
        .patch(`/api/monitors/${monitor.id}`)
        .set(authHeader(user.token))
        .send({ interval_seconds: 10 });

    expect(response.status).toBe(400);
});

test('owner can pause and resume a monitor', async () => {
    const user = await createUser();
    const monitor = await createMonitor(user.token);

    const pauseResponse = await request(app)
        .patch(`/api/monitors/${monitor.id}/pause`)
        .set(authHeader(user.token));

    expect(pauseResponse.status).toBe(200);
    expect(pauseResponse.body.is_active).toBe(false);

    const resumeResponse = await request(app)
        .patch(`/api/monitors/${monitor.id}/resume`)
        .set(authHeader(user.token));

    expect(resumeResponse.status).toBe(200);
    expect(resumeResponse.body.is_active).toBe(true);
});

test('owner can delete a monitor', async () => {
    const user = await createUser();
    const monitor = await createMonitor(user.token);

    const response = await request(app)
        .delete(`/api/monitors/${monitor.id}`)
        .set(authHeader(user.token));

    expect(response.status).toBe(200);

    const query = await pool.query(
        'SELECT id FROM monitors WHERE id = $1',
        [monitor.id]
    );

    expect(query.rows).toHaveLength(0);
});

test('another user cannot update or delete a monitor', async () => {
    const owner = await createUser();
    const otherUser = await createUser();
    const monitor = await createMonitor(owner.token);

    const updateResponse = await request(app)
        .patch(`/api/monitors/${monitor.id}`)
        .set(authHeader(otherUser.token))
        .send({ name: 'unauthorized-update' });

    expect(updateResponse.status).toBe(404);

    const deleteResponse = await request(app)
        .delete(`/api/monitors/${monitor.id}`)
        .set(authHeader(otherUser.token));

    expect(deleteResponse.status).toBe(404);

    const query = await pool.query(
        'SELECT name FROM monitors WHERE id = $1',
        [monitor.id]
    );

    expect(query.rows[0].name).toBe('crud-test-monitor');
});

test('another user cannot pause or resume a monitor', async () => {
    const owner = await createUser();
    const otherUser = await createUser();
    const monitor = await createMonitor(owner.token);

    const pauseResponse = await request(app)
        .patch(`/api/monitors/${monitor.id}/pause`)
        .set(authHeader(otherUser.token));

    expect(pauseResponse.status).toBe(404);

    const resumeResponse = await request(app)
        .patch(`/api/monitors/${monitor.id}/resume`)
        .set(authHeader(otherUser.token));

    expect(resumeResponse.status).toBe(404);
});

test('owner can fetch monitor details', async () => {
    const user = await createUser();
    const monitor = await createMonitor(user.token, 'detail-test-monitor');

    const response = await request(app)
        .get(`/api/monitors/${monitor.id}`)
        .set(authHeader(user.token));

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
        id: monitor.id,
        name: 'detail-test-monitor',
        url: 'https://example.com'
    });
});

test('monitor detail endpoint validates IDs and enforces ownership', async () => {
    const owner = await createUser();
    const otherUser = await createUser();
    const monitor = await createMonitor(owner.token);

    const invalidResponse = await request(app)
        .get('/api/monitors/not-a-number')
        .set(authHeader(owner.token));
    expect(invalidResponse.status).toBe(400);

    const missingResponse = await request(app)
        .get('/api/monitors/999999999')
        .set(authHeader(owner.token));
    expect(missingResponse.status).toBe(404);

    const forbiddenResponse = await request(app)
        .get(`/api/monitors/${monitor.id}`)
        .set(authHeader(otherUser.token));
    expect(forbiddenResponse.status).toBe(404);
});
