const {
    app,
    pool,
    request,
    resetDb,
    createUser,
    authHeader
} = require('./helpers');

let token;
let otherUserToken;
let monitorId;
let channelA;
let channelB;
let otherUserChannel;

async function createEmailChannel(userId, name) {
    const result = await pool.query(
        `INSERT INTO notification_channels (user_id, type, name, email)
         VALUES ($1, 'email', $2, $3)
         RETURNING id`,
        [userId, name, `${name.replace(/\s+/g, '.')}@example.com`]
    );

    return result.rows[0].id;
}

beforeEach(async () => {
    await resetDb();

    const user = await createUser();
    token = user.token;

    const otherUser = await createUser();
    otherUserToken = otherUser.token;

    const monitor = await request(app)
        .post('/api/monitors')
        .set(authHeader(token))
        .send({
            name: 'escalation-policy-test',
            url: 'https://example.com'
        });

    expect(monitor.status).toBe(201);
    monitorId = monitor.body.id;

    const owner = await pool.query(
        'SELECT user_id FROM monitors WHERE id = $1',
        [monitorId]
    );

    channelA = await createEmailChannel(owner.rows[0].user_id, 'Escalation A');
    channelB = await createEmailChannel(owner.rows[0].user_id, 'Escalation B');

    const otherOwner = await pool.query(
        'SELECT id FROM users ORDER BY id DESC LIMIT 1'
    );

    otherUserChannel = await createEmailChannel(
        otherOwner.rows[0].id,
        'Other User Escalation'
    );
});

afterAll(async () => {
    await pool.end();
});

test('returns an empty escalation policy by default', async () => {
    const response = await request(app)
        .get(`/api/monitors/${monitorId}/escalation`)
        .set(authHeader(token));

    expect(response.status).toBe(200);
    expect(response.body.monitor_id).toBe(monitorId);
    expect(response.body.stages).toEqual([]);
    expect(response.body.channels).toHaveLength(2);
});

test('saves and returns ordered escalation stages with channel routing', async () => {
    const stages = [
        {
            stage_number: 1,
            delay_minutes: 5,
            routing_mode: 'ALL',
            channel_ids: []
        },
        {
            stage_number: 2,
            delay_minutes: 15,
            routing_mode: 'SELECTED',
            channel_ids: [channelA, channelB]
        }
    ];

    const update = await request(app)
        .put(`/api/monitors/${monitorId}/escalation`)
        .set(authHeader(token))
        .send({ stages });

    expect(update.status).toBe(200);
    expect(update.body).toMatchObject({
        monitor_id: monitorId,
        stages
    });

    const response = await request(app)
        .get(`/api/monitors/${monitorId}/escalation`)
        .set(authHeader(token));

    expect(response.status).toBe(200);
    expect(response.body.stages).toHaveLength(2);
    expect(response.body.stages[0]).toMatchObject({
        stage_number: 1,
        delay_minutes: 5,
        routing_mode: 'ALL',
        channel_ids: []
    });
    expect(response.body.stages[1]).toMatchObject({
        stage_number: 2,
        delay_minutes: 15,
        routing_mode: 'SELECTED',
        channel_ids: [channelA, channelB]
    });
});

test('allows clearing an existing escalation policy', async () => {
    await request(app)
        .put(`/api/monitors/${monitorId}/escalation`)
        .set(authHeader(token))
        .send({
            stages: [{
                stage_number: 1,
                delay_minutes: 5,
                routing_mode: 'ALL',
                channel_ids: []
            }]
        });

    const response = await request(app)
        .put(`/api/monitors/${monitorId}/escalation`)
        .set(authHeader(token))
        .send({ stages: [] });

    expect(response.status).toBe(200);
    expect(response.body.stages).toEqual([]);

    const saved = await pool.query(
        'SELECT id FROM monitor_escalation_stages WHERE monitor_id = $1',
        [monitorId]
    );

    expect(saved.rows).toHaveLength(0);
});

test('rejects non-sequential stage numbers', async () => {
    const response = await request(app)
        .put(`/api/monitors/${monitorId}/escalation`)
        .set(authHeader(token))
        .send({
            stages: [{
                stage_number: 2,
                delay_minutes: 5,
                routing_mode: 'ALL',
                channel_ids: []
            }]
        });

    expect(response.status).toBe(400);
});

test('rejects delays that are not strictly increasing', async () => {
    const response = await request(app)
        .put(`/api/monitors/${monitorId}/escalation`)
        .set(authHeader(token))
        .send({
            stages: [
                {
                    stage_number: 1,
                    delay_minutes: 15,
                    routing_mode: 'ALL',
                    channel_ids: []
                },
                {
                    stage_number: 2,
                    delay_minutes: 10,
                    routing_mode: 'ALL',
                    channel_ids: []
                }
            ]
        });

    expect(response.status).toBe(400);
});

test('rejects more than five stages', async () => {
    const stages = Array.from({ length: 6 }, (_, index) => ({
        stage_number: index + 1,
        delay_minutes: (index + 1) * 5,
        routing_mode: 'ALL',
        channel_ids: []
    }));

    const response = await request(app)
        .put(`/api/monitors/${monitorId}/escalation`)
        .set(authHeader(token))
        .send({ stages });

    expect(response.status).toBe(400);
});

test('rejects a notification channel owned by another user', async () => {
    const response = await request(app)
        .put(`/api/monitors/${monitorId}/escalation`)
        .set(authHeader(token))
        .send({
            stages: [{
                stage_number: 1,
                delay_minutes: 5,
                routing_mode: 'SELECTED',
                channel_ids: [otherUserChannel]
            }]
        });

    expect(response.status).toBe(400);

    const saved = await pool.query(
        'SELECT id FROM monitor_escalation_stages WHERE monitor_id = $1',
        [monitorId]
    );

    expect(saved.rows).toHaveLength(0);
});

test('rejects SELECTED routing without a channel', async () => {
    const response = await request(app)
        .put(`/api/monitors/${monitorId}/escalation`)
        .set(authHeader(token))
        .send({
            stages: [{
                stage_number: 1,
                delay_minutes: 5,
                routing_mode: 'SELECTED',
                channel_ids: []
            }]
        });

    expect(response.status).toBe(400);
});

test('rejects duplicate channel IDs', async () => {
    const response = await request(app)
        .put(`/api/monitors/${monitorId}/escalation`)
        .set(authHeader(token))
        .send({
            stages: [{
                stage_number: 1,
                delay_minutes: 5,
                routing_mode: 'SELECTED',
                channel_ids: [channelA, channelA]
            }]
        });

    expect(response.status).toBe(400);
});

test('returns 404 when another user accesses the escalation policy', async () => {
    const response = await request(app)
        .get(`/api/monitors/${monitorId}/escalation`)
        .set(authHeader(otherUserToken));

    expect(response.status).toBe(404);
});

test('rejects invalid monitor IDs', async () => {
    const response = await request(app)
        .get('/api/monitors/not-a-number/escalation')
        .set(authHeader(token));

    expect(response.status).toBe(400);
});
