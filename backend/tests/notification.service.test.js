
jest.mock('../src/config/db', () => ({
    query: jest.fn()
}));

jest.mock('../src/services/httpCheck.service', () => ({
    checkHttp: jest.fn()
}));

const {
    buildSlackPayload,
    buildWebhookPayload,
    notifyUser
} = require('../src/services/notification.service');

describe('certificate notification formatting', () => {
    const event = {
        type: 'CERTIFICATE_EXPIRING',
        message: 'SSL certificate expires within 7 days',
        monitor: {
            id: 12,
            name: 'Production API',
            url: 'https://example.com/health'
        },
        certificateExpiresAt: '2026-11-05T00:00:00.000Z',
        certificateDaysRemaining: 7,
        occurredAt: '2026-10-29T08:00:00.000Z'
    };

    test('builds a certificate-specific Slack warning', () => {
        const payload = buildSlackPayload(event);

        expect(payload.text).toContain('Production API');
        expect(payload.text).toContain('SSL certificate is expiring');
        expect(payload.text).toContain('Days remaining: 7');
        expect(payload.text).not.toContain('PulseIQ test notification');
    });

    test('builds a certificate-specific Slack expired message', () => {
        const payload = buildSlackPayload({
            ...event,
            type: 'CERTIFICATE_EXPIRED',
            certificateDaysRemaining: -1
        });

        expect(payload.text).toContain('SSL certificate has EXPIRED');
        expect(payload.text).not.toContain('PulseIQ test notification');
    });

    test('includes certificate details in the webhook payload', () => {
        const payload = buildWebhookPayload(event);

        expect(payload).toMatchObject({
            source: 'pulseiq',
            event: 'CERTIFICATE_EXPIRING',
            certificate_expires_at: '2026-11-05T00:00:00.000Z',
            certificate_days_remaining: 7,
            occurred_at: '2026-10-29T08:00:00.000Z'
        });
    });

    test('identifies expired certificates in webhook payloads', () => {
        const payload = buildWebhookPayload({
            ...event,
            type: 'CERTIFICATE_EXPIRED',
            certificateDaysRemaining: -1
        });

        expect(payload.event).toBe('CERTIFICATE_EXPIRED');
        expect(payload.certificate_days_remaining).toBe(-1);
    });
});

describe('notifyUser delivery', () => {
    const db = require('../src/config/db');
    const { checkHttp } = require('../src/services/httpCheck.service');
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});

    beforeEach(() => {
        jest.clearAllMocks();
    });

    afterAll(() => {
        consoleError.mockRestore();
    });

    const event = {
        type: 'DOWN',
        monitor: {
            id: 12,
            name: 'Production API',
            url: 'https://example.com/health'
        },
        occurredAt: '2026-10-29T08:00:00.000Z'
    };

    test('delivers to all active channels belonging to the requested user', async () => {
        db.query.mockResolvedValueOnce({
            rows: [
                { id: 1, type: 'slack', name: 'Team Slack', url: 'https://hooks.slack.com/services/test' },
                { id: 2, type: 'webhook', name: 'Incident Webhook', url: 'https://example.com/webhook' }
            ]
        });
        checkHttp.mockResolvedValue({ statusCode: 200 });

        const results = await notifyUser(7, event);

        expect(db.query).toHaveBeenCalledWith(
            expect.stringContaining('WHERE user_id = $1 AND is_active = true'),
            [7]
        );
        expect(checkHttp).toHaveBeenCalledTimes(2);
        expect(checkHttp).toHaveBeenNthCalledWith(
            1,
            expect.objectContaining({
                url: 'https://hooks.slack.com/services/test',
                method: 'POST',
                timeout_ms: 5000
            })
        );
        expect(results).toEqual([
            { channel_id: 1, ok: true, error: null },
            { channel_id: 2, ok: true, error: null }
        ]);
    });

    test('returns an empty array when no active channels exist', async () => {
        db.query.mockResolvedValueOnce({ rows: [] });

        const results = await notifyUser(7, event);

        expect(results).toEqual([]);
        expect(checkHttp).not.toHaveBeenCalled();
    });

    test('reports non-2xx responses as channel failures', async () => {
        db.query.mockResolvedValueOnce({
            rows: [
                { id: 3, type: 'webhook', name: 'Failed Webhook', url: 'https://example.com/webhook' }
            ]
        });
        checkHttp.mockResolvedValueOnce({ statusCode: 503 });

        const results = await notifyUser(7, event);

        expect(results).toEqual([
            {
                channel_id: 3,
                ok: false,
                error: 'Channel responded with HTTP 503'
            }
        ]);
    });

    test('continues delivery when one channel rejects', async () => {
        db.query.mockResolvedValueOnce({
            rows: [
                { id: 4, type: 'webhook', name: 'Unavailable Webhook', url: 'https://example.com/failing' },
                { id: 5, type: 'slack', name: 'Working Slack', url: 'https://hooks.slack.com/services/working' }
            ]
        });
        checkHttp
            .mockRejectedValueOnce(new Error('Connection refused'))
            .mockResolvedValueOnce({ statusCode: 200 });

        const results = await notifyUser(7, event);

        expect(checkHttp).toHaveBeenCalledTimes(2);
        expect(results).toEqual([
            { channel_id: 4, ok: false, error: 'Connection refused' },
            { channel_id: 5, ok: true, error: null }
        ]);
    });

    test('does not throw when loading channels from the database fails', async () => {
        db.query.mockRejectedValueOnce(new Error('Database unavailable'));

        const results = await notifyUser(7, event);

        expect(results).toEqual([]);
        expect(checkHttp).not.toHaveBeenCalled();
        expect(consoleError).toHaveBeenCalled();
    });
});