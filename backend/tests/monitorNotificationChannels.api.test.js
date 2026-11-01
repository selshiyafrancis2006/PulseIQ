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
            name: 'notification-routing-test',
            url: 'https://example.com'
        });

    expect(monitor.status).toBe(201);
    monitorId = monitor.body.id;

    const owner = await pool.query(
        'SELECT user_id FROM monitors WHERE id = $1',
        [monitorId]
    );

    channelA = await createEmailChannel(owner.rows[0].user_id, 'Channel A');
    channelB = await createEmailChannel(owner.rows[0].user_id, 'Channel B');

    const otherOwner = await pool.query(
        'SELECT id FROM users ORDER BY id DESC LIMIT 1'
    );

    otherUserChannel = await createEmailChannel(
        otherOwner.rows[0].id,
        'Other User Channel'
    );
});

afterAll(async () => {
    await pool.end();
});

test('returns ALL routing by default when no settings row exists', async () => {
    const response = await request(app)
        .get(`/api/monitors/${monitorId}/notification-channels`)
        .set(authHeader(token));

    expect(response.status).toBe(200);
    expect(response.body.routing_mode).toBe('ALL');
    expect(response.body.channel_ids).toEqual([]);
    expect(response.body.channels).toHaveLength(2);
    expect(response.body.channels.every(channel => channel.is_selected === false))
        .toBe(true);
});

test('saves and returns selected notification channels', async () => {
    const update = await request(app)
        .put(`/api/monitors/${monitorId}/notification-channels`)
        .set(authHeader(token))
        .send({
            routing_mode: 'SELECTED',
            channel_ids: [channelA, channelB]
        });

    expect(update.status).toBe(200);
    expect(update.body).toMatchObject({
        monitor_id: monitorId,
        routing_mode: 'SELECTED',
        channel_ids: [channelA, channelB]
    });

    const response = await request(app)
        .get(`/api/monitors/${monitorId}/notification-channels`)
        .set(authHeader(token));

    expect(response.status).toBe(200);
    expect(response.body.routing_mode).toBe('SELECTED');
    expect(response.body.channel_ids).toEqual([channelA, channelB]);
    expect(response.body.channels.filter(channel => channel.is_selected))
        .toHaveLength(2);
});

test('allows SELECTED routing with an empty channel list', async () => {
    const response = await request(app)
        .put(`/api/monitors/${monitorId}/notification-channels`)
        .set(authHeader(token))
        .send({
            routing_mode: 'SELECTED',
            channel_ids: []
        });

    expect(response.status).toBe(200);
    expect(response.body.routing_mode).toBe('SELECTED');
    expect(response.body.channel_ids).toEqual([]);

    const saved = await pool.query(
        `SELECT routing_mode
         FROM monitor_notification_settings
         WHERE monitor_id = $1`,
        [monitorId]
    );

    expect(saved.rows[0].routing_mode).toBe('SELECTED');

    const mappings = await pool.query(
        `SELECT channel_id
         FROM monitor_notification_channels
         WHERE monitor_id = $1`,
        [monitorId]
    );

    expect(mappings.rows).toHaveLength(0);
});

test('rejects a channel owned by another user', async () => {
    const response = await request(app)
        .put(`/api/monitors/${monitorId}/notification-channels`)
        .set(authHeader(token))
        .send({
            routing_mode: 'SELECTED',
            channel_ids: [channelA, otherUserChannel]
        });

    expect(response.status).toBe(400);

    const settings = await pool.query(
        `SELECT * FROM monitor_notification_settings
         WHERE monitor_id = $1`,
        [monitorId]
    );

    expect(settings.rows).toHaveLength(0);
});

test('returns 404 when another user accesses the monitor routing', async () => {
    const response = await request(app)
        .get(`/api/monitors/${monitorId}/notification-channels`)
        .set(authHeader(otherUserToken));

    expect(response.status).toBe(404);
});

test('rejects duplicate channel IDs', async () => {
    const response = await request(app)
        .put(`/api/monitors/${monitorId}/notification-channels`)
        .set(authHeader(token))
        .send({
            routing_mode: 'SELECTED',
            channel_ids: [channelA, channelA]
        });

    expect(response.status).toBe(400);
});

test('rejects invalid routing modes and invalid channel IDs', async () => {
    const invalidMode = await request(app)
        .put(`/api/monitors/${monitorId}/notification-channels`)
        .set(authHeader(token))
        .send({
            routing_mode: 'NONE',
            channel_ids: []
        });

    expect(invalidMode.status).toBe(400);

    const invalidIds = await request(app)
        .put(`/api/monitors/${monitorId}/notification-channels`)
        .set(authHeader(token))
        .send({
            routing_mode: 'SELECTED',
            channel_ids: [channelA, 'invalid']
        });

    expect(invalidIds.status).toBe(400);
});

test('switching back to ALL removes previous channel mappings', async () => {
    await request(app)
        .put(`/api/monitors/${monitorId}/notification-channels`)
        .set(authHeader(token))
        .send({
            routing_mode: 'SELECTED',
            channel_ids: [channelA]
        });

    const response = await request(app)
        .put(`/api/monitors/${monitorId}/notification-channels`)
        .set(authHeader(token))
        .send({
            routing_mode: 'ALL',
            channel_ids: []
        });

    expect(response.status).toBe(200);
    expect(response.body.routing_mode).toBe('ALL');

    const mappings = await pool.query(
        `SELECT channel_id
         FROM monitor_notification_channels
         WHERE monitor_id = $1`,
        [monitorId]
    );

    expect(mappings.rows).toHaveLength(0);
});
