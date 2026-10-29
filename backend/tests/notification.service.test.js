
jest.mock('../src/config/db', () => ({
    query: jest.fn()
}));

jest.mock('../src/services/httpCheck.service', () => ({
    checkHttp: jest.fn()
}));

const {
    buildSlackPayload,
    buildWebhookPayload
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
