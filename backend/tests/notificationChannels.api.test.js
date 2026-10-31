jest.mock('../src/services/urlSecurity.service', () => ({
    ...jest.requireActual('../src/services/urlSecurity.service'),
    validatePublicHttpUrl: jest.fn().mockResolvedValue({})
}));

jest.mock('../src/services/notification.service', () => ({
    ...jest.requireActual('../src/services/notification.service'),
    sendToChannel: jest.fn().mockResolvedValue(undefined)
}));

const {
    app,
    pool,
    request,
    resetDb,
    createUser,
    authHeader
} = require('./helpers');

const { validatePublicHttpUrl } = require('../src/services/urlSecurity.service');
const { sendToChannel } = require('../src/services/notification.service');

let token;
let otherToken;
let channelId;

const baseUrl = '/api/notification-channels';
const webhookUrl = 'https://example.com/hooks/secret-token-1234';
const slackUrl = 'https://hooks.slack.com/services/test-token';

async function createChannel(authToken, overrides = {}) {
    const response = await request(app)
        .post(baseUrl)
        .set(authHeader(authToken))
        .send({
            type: 'webhook',
            name: 'Test webhook',
            url: webhookUrl,
            ...overrides
        });

    return response;
}

beforeEach(async () => {
    await resetDb();
    jest.clearAllMocks();

    const user = await createUser();
    token = user.token;

    const otherUser = await createUser();
    otherToken = otherUser.token;
});

afterAll(async () => {
    await pool.end();
});

describe('notification channel API', () => {
    describe('authentication', () => {
        test('rejects unauthenticated requests', async () => {
            const response = await request(app).get(baseUrl);

            expect(response.status).toBe(401);
        });
    });

    describe('creation', () => {
        test('creates a webhook channel and hides its full URL', async () => {
            const response = await createChannel(token);

            expect(response.status).toBe(201);
            expect(response.body).toMatchObject({
                type: 'webhook',
                name: 'Test webhook',
                is_active: true
            });
            expect(response.body.url_hint).toContain('example.com');
            expect(JSON.stringify(response.body)).not.toContain(webhookUrl);

            channelId = response.body.id;

            const saved = await pool.query(
                'SELECT user_id, type, name, url FROM notification_channels WHERE id = $1',
                [channelId]
            );

            expect(saved.rows[0]).toMatchObject({
                type: 'webhook',
                name: 'Test webhook',
                url: webhookUrl
            });
            expect(validatePublicHttpUrl).toHaveBeenCalledWith(webhookUrl);
        });

        test('creates a Slack channel with a valid Slack URL', async () => {
            const response = await createChannel(token, {
                type: 'slack',
                name: 'Team Slack',
                url: slackUrl
            });

            expect(response.status).toBe(201);
            expect(response.body.type).toBe('slack');
            expect(response.body.name).toBe('Team Slack');
        });

        test('rejects unsupported channel types', async () => {
            const response = await createChannel(token, {
                type: 'sms'
            });

            expect(response.status).toBe(400);
            expect(response.body.message).toContain('slack, webhook, email');
        });

        test('creates an email channel and masks its recipient', async () => {
            const recipient = 'alerts@example.com';

            const response = await createChannel(token, {
                type: 'email',
                name: 'Email alerts',
                url: null,
                email: recipient
            });

            expect(response.status).toBe(201);
            expect(response.body).toMatchObject({
                type: 'email',
                name: 'Email alerts',
                email_hint: 'a***@example.com',
                url_hint: null
            });
            expect(JSON.stringify(response.body)).not.toContain(recipient);

            const saved = await pool.query(
                'SELECT type, name, url, email FROM notification_channels WHERE id = $1',
                [response.body.id]
            );

            expect(saved.rows[0]).toMatchObject({
                type: 'email',
                name: 'Email alerts',
                url: null,
                email: recipient
            });
            expect(validatePublicHttpUrl).not.toHaveBeenCalled();
        });

        test.each([
            ['missing email', undefined],
            ['malformed email', 'not-an-email'],
            ['email without a domain suffix', 'alerts@example'],
            ['email containing whitespace', 'alerts @example.com'],
            ['email longer than 254 characters', `${'a'.repeat(245)}@example.com`]
        ])('rejects a %s', async (_description, email) => {
            const response = await createChannel(token, {
                type: 'email',
                url: null,
                email
            });

            expect(response.status).toBe(400);
            expect(response.body.message).toContain('email');
        });

        test('rejects an empty or invalid channel name', async () => {
            const response = await createChannel(token, {
                name: '   '
            });

            expect(response.status).toBe(400);
            expect(response.body.message).toContain('name');
        });

        test('rejects a Slack URL outside the Slack webhook host', async () => {
            const response = await createChannel(token, {
                type: 'slack',
                url: 'https://example.com/webhook'
            });

            expect(response.status).toBe(400);
            expect(response.body.message).toContain('Slack URL');
            expect(validatePublicHttpUrl).not.toHaveBeenCalled();
        });

        test('rejects URLs that fail public URL validation', async () => {
            validatePublicHttpUrl.mockRejectedValueOnce(
                new Error('Monitor URL resolves to a non-public IP address')
            );

            const response = await createChannel(token);

            expect(response.status).toBe(400);
            expect(response.body.message).toContain('non-public IP');
        });

        test('enforces the maximum of ten channels per user', async () => {
            for (let index = 0; index < 10; index += 1) {
                const response = await createChannel(token, {
                    name: `Webhook ${index + 1}`
                });

                expect(response.status).toBe(201);
            }

            const response = await createChannel(token, {
                name: 'Eleventh webhook'
            });

            expect(response.status).toBe(400);
            expect(response.body.message).toContain('at most 10 channels');

            const count = await pool.query(
                'SELECT COUNT(*)::int AS n FROM notification_channels'
            );
            expect(count.rows[0].n).toBe(10);
        });
    });

    describe('listing', () => {
        test('lists only the authenticated user channels without exposing URLs', async () => {
            await createChannel(token);
            await createChannel(otherToken, {
                name: 'Other user webhook'
            });

            const response = await request(app)
                .get(baseUrl)
                .set(authHeader(token));

            expect(response.status).toBe(200);
            expect(response.body).toHaveLength(1);
            expect(response.body[0].name).toBe('Test webhook');
            expect(JSON.stringify(response.body)).not.toContain(webhookUrl);
        });
    });

    describe('updating', () => {
        beforeEach(async () => {
            const response = await createChannel(token);
            channelId = response.body.id;
        });

        test('updates the channel name and active state', async () => {
            const response = await request(app)
                .patch(`${baseUrl}/${channelId}`)
                .set(authHeader(token))
                .send({
                    name: 'Updated webhook',
                    is_active: false
                });

            expect(response.status).toBe(200);
            expect(response.body).toMatchObject({
                name: 'Updated webhook',
                is_active: false
            });
        });

        test('prevents another user from updating the channel', async () => {
            const response = await request(app)
                .patch(`${baseUrl}/${channelId}`)
                .set(authHeader(otherToken))
                .send({ name: 'Hijacked channel' });

            expect(response.status).toBe(404);
        });

        test('rejects an invalid active-state value', async () => {
            const response = await request(app)
                .patch(`${baseUrl}/${channelId}`)
                .set(authHeader(token))
                .send({ is_active: 'false' });

            expect(response.status).toBe(400);
            expect(response.body.message).toContain('is_active');
        });

        test('rejects unsupported update fields', async () => {
            const response = await request(app)
                .patch(`${baseUrl}/${channelId}`)
                .set(authHeader(token))
                .send({ url: 'https://attacker.example' });

            expect(response.status).toBe(400);
        });

        test('rejects invalid channel IDs', async () => {
            const response = await request(app)
                .patch(`${baseUrl}/abc`)
                .set(authHeader(token))
                .send({ name: 'Updated' });

            expect(response.status).toBe(400);
        });
    });

    describe('deletion', () => {
        beforeEach(async () => {
            const response = await createChannel(token);
            channelId = response.body.id;
        });

        test('prevents another user from deleting the channel', async () => {
            const response = await request(app)
                .delete(`${baseUrl}/${channelId}`)
                .set(authHeader(otherToken));

            expect(response.status).toBe(404);

            const saved = await pool.query(
                'SELECT id FROM notification_channels WHERE id = $1',
                [channelId]
            );
            expect(saved.rows).toHaveLength(1);
        });

        test('deletes a channel owned by the authenticated user', async () => {
            const response = await request(app)
                .delete(`${baseUrl}/${channelId}`)
                .set(authHeader(token));

            expect(response.status).toBe(200);
            expect(response.body.message).toBe('Channel deleted');

            const saved = await pool.query(
                'SELECT id FROM notification_channels WHERE id = $1',
                [channelId]
            );
            expect(saved.rows).toHaveLength(0);
        });
    });

    describe('test delivery', () => {
        beforeEach(async () => {
            const response = await createChannel(token);
            channelId = response.body.id;
        });

        test('sends a test notification through the selected channel', async () => {
            const response = await request(app)
                .post(`${baseUrl}/${channelId}/test`)
                .set(authHeader(token));

            expect(response.status).toBe(200);
            expect(response.body).toEqual({ ok: true });
            expect(sendToChannel).toHaveBeenCalledWith(
                expect.objectContaining({
                    id: channelId,
                    type: 'webhook'
                }),
                expect.objectContaining({
                    type: 'TEST',
                    message: 'This is a test notification from PulseIQ'
                })
            );
        });

        test('returns 502 when test notification delivery fails', async () => {
            sendToChannel.mockRejectedValueOnce(
                new Error('Webhook returned HTTP 503')
            );

            const response = await request(app)
                .post(`${baseUrl}/${channelId}/test`)
                .set(authHeader(token));

            expect(response.status).toBe(502);
            expect(response.body).toMatchObject({
                ok: false,
                message: 'Webhook returned HTTP 503'
            });
        });

        test('prevents another user from testing the channel', async () => {
            const response = await request(app)
                .post(`${baseUrl}/${channelId}/test`)
                .set(authHeader(otherToken));

            expect(response.status).toBe(404);
            expect(sendToChannel).not.toHaveBeenCalled();
        });
    });

    describe('additional validation and error handling', () => {
        test('returns 500 when listing channels fails at the database', async () => {
            const querySpy = jest.spyOn(pool, 'query')
                .mockRejectedValueOnce(new Error('Database unavailable'));
            const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

            try {
                const response = await request(app)
                    .get(baseUrl)
                    .set(authHeader(token));

                expect(response.status).toBe(500);
                expect(response.body.message).toBe('Failed to fetch channels');
            } finally {
                querySpy.mockRestore();
                errorSpy.mockRestore();
            }
        });

        test.each([
            ['missing URL', undefined],
            ['malformed URL', 'not-a-valid-url'],
            ['URL longer than 500 characters', `https://example.com/${'a'.repeat(500)}`]
        ])('rejects a %s during creation', async (_description, url) => {
            const response = await createChannel(token, { url });

            expect(response.status).toBe(400);
            expect(response.body.message).toContain('url');
        });

        test('rejects an HTTP Slack URL', async () => {
            const response = await createChannel(token, {
                type: 'slack',
                url: 'http://hooks.slack.com/services/test-token'
            });

            expect(response.status).toBe(400);
            expect(response.body.message).toContain('Slack URL');
        });

        test('rejects an empty update body', async () => {
            const created = await createChannel(token);

            const response = await request(app)
                .patch(`${baseUrl}/${created.body.id}`)
                .set(authHeader(token))
                .send({});

            expect(response.status).toBe(400);
            expect(response.body.message).toContain('supported fields');
        });

        test.each([
            ['blank name', '   '],
            ['name longer than 100 characters', 'a'.repeat(101)]
        ])('rejects an update with a %s', async (_description, name) => {
            const created = await createChannel(token);

            const response = await request(app)
                .patch(`${baseUrl}/${created.body.id}`)
                .set(authHeader(token))
                .send({ name });

            expect(response.status).toBe(400);
            expect(response.body.message).toContain('name');
        });

        test('returns 404 when updating a channel that does not exist', async () => {
            const response = await request(app)
                .patch(`${baseUrl}/999999`)
                .set(authHeader(token))
                .send({ name: 'Updated channel' });

            expect(response.status).toBe(404);
        });

        test('rejects an invalid channel ID during deletion', async () => {
            const response = await request(app)
                .delete(`${baseUrl}/0`)
                .set(authHeader(token));

            expect(response.status).toBe(400);
        });

        test('returns 404 when deleting a channel that does not exist', async () => {
            const response = await request(app)
                .delete(`${baseUrl}/999999`)
                .set(authHeader(token));

            expect(response.status).toBe(404);
        });

        test('rejects an invalid channel ID during test delivery', async () => {
            const response = await request(app)
                .post(`${baseUrl}/abc/test`)
                .set(authHeader(token));

            expect(response.status).toBe(400);
            expect(sendToChannel).not.toHaveBeenCalled();
        });

        test('returns 404 when testing a channel that does not exist', async () => {
            const response = await request(app)
                .post(`${baseUrl}/999999/test`)
                .set(authHeader(token));

            expect(response.status).toBe(404);
            expect(sendToChannel).not.toHaveBeenCalled();
        });
    });
});

