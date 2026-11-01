jest.mock('nodemailer', () => ({
    createTransport: jest.fn()
}));

const {
    app,
    pool,
    request,
    resetDb,
    createUser,
    authHeader
} = require('./helpers');

const nodemailer = require('nodemailer');
const { notifyUser } = require('../src/services/notification.service');

const originalEnv = { ...process.env };

const transporter = {
    sendMail: jest.fn().mockResolvedValue({
        messageId: 'pulseiq-routing-test'
    }),
    close: jest.fn()
};

async function createEmailChannel(userId, name, email) {
    const result = await pool.query(
        `INSERT INTO notification_channels (user_id, type, name, email)
         VALUES ($1, 'email', $2, $3)
         RETURNING id`,
        [userId, name, email]
    );

    return result.rows[0].id;
}

beforeEach(async () => {
    await resetDb();
    jest.clearAllMocks();

    process.env.SMTP_HOST = 'smtp.test.invalid';
    process.env.SMTP_PORT = '587';
    process.env.SMTP_FROM = 'PulseIQ Test <pulseiq@test.invalid>';

    nodemailer.createTransport.mockReturnValue(transporter);
    transporter.sendMail.mockResolvedValue({
        messageId: 'pulseiq-routing-test'
    });
});

afterAll(async () => {
    for (const key of [
        'SMTP_HOST',
        'SMTP_PORT',
        'SMTP_SECURE',
        'SMTP_USER',
        'SMTP_PASS',
        'SMTP_FROM'
    ]) {
        if (originalEnv[key] === undefined) {
            delete process.env[key];
        } else {
            process.env[key] = originalEnv[key];
        }
    }

    await pool.end();
});

test('delivers DOWN notifications according to SELECTED and ALL monitor routing', async () => {
    const user = await createUser();

    const monitorResponse = await request(app)
        .post('/api/monitors')
        .set(authHeader(user.token))
        .send({
            name: 'routing-dispatch-integration-test',
            url: 'https://example.com'
        });

    expect(monitorResponse.status).toBe(201);

    const monitorId = monitorResponse.body.id;

    const ownerResult = await pool.query(
        'SELECT user_id FROM monitors WHERE id = $1',
        [monitorId]
    );

    const userId = ownerResult.rows[0].user_id;

    const channelAEmail = 'channel-a@test.invalid';
    const channelBEmail = 'channel-b@test.invalid';

    const channelA = await createEmailChannel(
        userId,
        'Channel A',
        channelAEmail
    );

    const channelB = await createEmailChannel(
        userId,
        'Channel B',
        channelBEmail
    );

    const event = {
        type: 'DOWN',
        message: 'Integration test monitor is DOWN',
        errorType: 'ECONNREFUSED',
        errorMessage: 'Controlled integration test failure',
        monitor: {
            id: monitorId,
            name: 'routing-dispatch-integration-test',
            url: 'https://example.com'
        },
        occurredAt: '2026-11-01T12:00:00.000Z'
    };

    // Configure SELECTED routing with Channel A only.
    const selectedResponse = await request(app)
        .put(`/api/monitors/${monitorId}/notification-channels`)
        .set(authHeader(user.token))
        .send({
            routing_mode: 'SELECTED',
            channel_ids: [channelA]
        });

    expect(selectedResponse.status).toBe(200);
    expect(selectedResponse.body.routing_mode).toBe('SELECTED');
    expect(selectedResponse.body.channel_ids).toEqual([channelA]);

    // Exercise the real dispatcher and PostgreSQL routing query.
    const selectedResults = await notifyUser(userId, event);

    expect(selectedResults).toEqual([
        {
            channel_id: channelA,
            ok: true,
            error: null
        }
    ]);

    expect(transporter.sendMail).toHaveBeenCalledTimes(1);
    expect(transporter.sendMail.mock.calls.map(([message]) => message.to))
        .toEqual([channelAEmail]);

    // Clear delivery observations before testing ALL routing.
    transporter.sendMail.mockClear();
    transporter.close.mockClear();
    nodemailer.createTransport.mockClear();

    // Switch the same monitor to ALL.
    const allResponse = await request(app)
        .put(`/api/monitors/${monitorId}/notification-channels`)
        .set(authHeader(user.token))
        .send({
            routing_mode: 'ALL',
            channel_ids: []
        });

    expect(allResponse.status).toBe(200);
    expect(allResponse.body.routing_mode).toBe('ALL');

    const allResults = await notifyUser(userId, event);

    expect(allResults).toEqual([
        {
            channel_id: channelA,
            ok: true,
            error: null
        },
        {
            channel_id: channelB,
            ok: true,
            error: null
        }
    ]);

    expect(transporter.sendMail).toHaveBeenCalledTimes(2);

    expect(
        transporter.sendMail.mock.calls
            .map(([message]) => message.to)
            .sort()
    ).toEqual([channelAEmail, channelBEmail].sort());
});
