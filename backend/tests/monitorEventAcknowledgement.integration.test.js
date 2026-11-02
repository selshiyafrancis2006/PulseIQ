const {
    app,
    pool,
    resetDb,
    createUser,
    authHeader,
    request
} = require('./helpers');

let owner;
let monitorId;

beforeEach(async () => {
    await resetDb();

    owner = await createUser();

    const response = await request(app)
        .post('/api/monitors')
        .set(authHeader(owner.token))
        .send({
            name: 'event-ack-test-monitor',
            url: 'https://example.com'
        });

    expect(response.status).toBe(201);
    monitorId = response.body.id;
});

afterAll(async () => {
    await pool.end();
});

async function createEvent(type = 'DOWN') {
    const result = await pool.query(
        `INSERT INTO monitor_events
            (monitor_id, type, message, response_time_ms)
         VALUES ($1, $2, $3, $4)
         RETURNING id`,
        [monitorId, type, `Test ${type} event`, 1200]
    );

    return result.rows[0].id;
}

function acknowledge(eventId, monitor = monitorId, token = owner.token) {
    return request(app)
        .patch(`/api/monitors/${monitor}/events/${eventId}/acknowledge`)
        .set(authHeader(token));
}

test('acknowledges a DOWN event and returns acknowledgement details', async () => {
    const eventId = await createEvent('DOWN');

    const response = await acknowledge(eventId);

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
        message: 'Monitor event acknowledged',
        id: eventId,
        monitor_id: monitorId
    });
    expect(response.body.acknowledged_at).toBeTruthy();
    expect(response.body.acknowledged_by).toBeTruthy();

    const saved = await pool.query(
        `SELECT acknowledged_at, acknowledged_by
         FROM monitor_events
         WHERE id = $1`,
        [eventId]
    );

    expect(saved.rows[0].acknowledged_at).toBeTruthy();
    expect(saved.rows[0].acknowledged_by).toBeTruthy();
});

test('repeated acknowledgement preserves the original acknowledgement', async () => {
    const eventId = await createEvent('DOWN');

    const first = await acknowledge(eventId);
    expect(first.status).toBe(200);

    const second = await acknowledge(eventId);
    expect(second.status).toBe(200);

    expect(second.body.acknowledged_at).toBe(first.body.acknowledged_at);
    expect(second.body.acknowledged_by).toBe(first.body.acknowledged_by);
});

test('GET monitor events includes acknowledgement fields', async () => {
    const eventId = await createEvent('DOWN');

    const acknowledged = await acknowledge(eventId);
    expect(acknowledged.status).toBe(200);

    const response = await request(app)
        .get(`/api/monitors/${monitorId}/events`)
        .set(authHeader(owner.token));

    expect(response.status).toBe(200);

    const event = response.body.find(item => item.id === eventId);

    expect(event).toMatchObject({
        acknowledged_by: acknowledged.body.acknowledged_by
    });
    expect(event.acknowledged_at).toBe(acknowledged.body.acknowledged_at);
});

test('another user cannot acknowledge an event belonging to this monitor', async () => {
    const eventId = await createEvent('DOWN');
    const otherUser = await createUser();

    const response = await acknowledge(eventId, monitorId, otherUser.token);

    expect(response.status).toBe(404);
});

test('rejects invalid monitor and event IDs', async () => {
    const eventId = await createEvent('DOWN');

    const invalidMonitor = await acknowledge(eventId, 'invalid');
    expect(invalidMonitor.status).toBe(400);

    const invalidEvent = await acknowledge('invalid');
    expect(invalidEvent.status).toBe(400);
});

test('returns 404 when the event does not exist', async () => {
    const response = await acknowledge(999999);

    expect(response.status).toBe(404);
});

test('does not allow acknowledgement of UP events', async () => {
    const eventId = await createEvent('UP');

    const response = await acknowledge(eventId);

    expect(response.status).toBe(409);
    expect(response.body.message).toMatch(/only DOWN/i);

    const saved = await pool.query(
        `SELECT acknowledged_at, acknowledged_by
         FROM monitor_events
         WHERE id = $1`,
        [eventId]
    );

    expect(saved.rows[0].acknowledged_at).toBeNull();
    expect(saved.rows[0].acknowledged_by).toBeNull();
});