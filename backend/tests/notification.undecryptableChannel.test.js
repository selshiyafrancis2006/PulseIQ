jest.mock('../src/config/db', () => ({
    query: jest.fn()
}));

jest.mock('../src/services/httpCheck.service', () => ({
    checkHttp: jest.fn()
}));

jest.mock('nodemailer', () => ({
    createTransport: jest.fn()
}));

const crypto = require('crypto');

if (!process.env.NOTIFICATION_ENCRYPTION_KEY) {
    process.env.NOTIFICATION_ENCRYPTION_KEY = crypto.randomBytes(32).toString('base64');
}

const db = require('../src/config/db');
const { checkHttp } = require('../src/services/httpCheck.service');
const { encryptUrl } = require('../src/services/notificationChannelCrypto.service');
const { notifyUser } = require('../src/services/notification.service');

const event = {
    type: 'DOWN',
    monitor: { id: 12, name: 'Production API', url: 'https://example.com/health' },
    occurredAt: '2026-11-01T08:00:00.000Z'
};

describe('notifyUser with a channel whose URL cannot be decrypted', () => {
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});

    beforeEach(() => {
        jest.clearAllMocks();
        checkHttp.mockResolvedValue({ statusCode: 200 });
    });

    afterAll(() => {
        consoleError.mockRestore();
    });

    test('still delivers to the other channels when the first one is plain text', async () => {
        db.query.mockResolvedValueOnce({
            rows: [
                { id: 1, type: 'slack', name: 'Legacy Slack', url: 'https://hooks.slack.com/services/plain' },
                { id: 2, type: 'webhook', name: 'Webhook', url: encryptUrl('https://example.com/hook') }
            ]
        });

        const results = await notifyUser(7, event);

        expect(results).toHaveLength(2);
        expect(results[0]).toMatchObject({ channel_id: 1, ok: false });
        expect(results[1]).toMatchObject({ channel_id: 2, ok: true });
        expect(checkHttp).toHaveBeenCalledTimes(1);
        expect(checkHttp).toHaveBeenCalledWith(
            expect.objectContaining({ url: 'https://example.com/hook' })
        );
    });

    test('still delivers to earlier channels when a later one is corrupted', async () => {
        db.query.mockResolvedValueOnce({
            rows: [
                { id: 1, type: 'webhook', name: 'Webhook', url: encryptUrl('https://example.com/hook') },
                { id: 2, type: 'slack', name: 'Broken', url: 'enc:v1:not:valid' }
            ]
        });

        const results = await notifyUser(7, event);

        expect(results[0]).toMatchObject({ channel_id: 1, ok: true });
        expect(results[1]).toMatchObject({ channel_id: 2, ok: false });
    });

    test('reports why the channel failed instead of throwing', async () => {
        db.query.mockResolvedValueOnce({
            rows: [{ id: 3, type: 'slack', name: 'Legacy', url: 'https://hooks.slack.com/services/plain' }]
        });

        await expect(notifyUser(7, event)).resolves.toEqual([
            expect.objectContaining({
                channel_id: 3,
                ok: false,
                error: expect.stringMatching(/not encrypted/)
            })
        ]);
    });
});