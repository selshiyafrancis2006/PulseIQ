const {
    app,
    pool,
    resetDb,
    createUser,
    authHeader,
    request
} = require('./helpers');

const { encryptUrl } = require('../src/services/notificationChannelCrypto.service');

beforeAll(async () => {
    await resetDb();
});

afterAll(async () => {
    await pool.end();
});

async function userId(email) {
    const result = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
    return result.rows[0].id;
}

describe('listing channels that include an unreadable URL', () => {
    test('still lists every channel when one URL is stored as plain text', async () => {
        const user = await createUser();
        const id = await userId(user.email);

        await pool.query(
            `INSERT INTO notification_channels (user_id, type, name, url)
             VALUES ($1, 'slack', 'Legacy Slack', 'https://hooks.slack.com/services/plain'),
                    ($1, 'webhook', 'Secure webhook', $2)`,
            [id, encryptUrl('https://example.com/hooks/abcd')]
        );

        const response = await request(app)
            .get('/api/notification-channels')
            .set(authHeader(user.token));

        expect(response.status).toBe(200);
        expect(response.body).toHaveLength(2);

        const legacy = response.body.find((channel) => channel.name === 'Legacy Slack');
        const secure = response.body.find((channel) => channel.name === 'Secure webhook');

        expect(legacy.url_hint).toBeNull();
        expect(secure.url_hint).toBe('example.com/…abcd');
        expect(JSON.stringify(response.body)).not.toContain('hooks.slack.com/services');
    });
});