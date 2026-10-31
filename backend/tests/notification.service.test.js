jest.mock('../src/config/db', () => ({
    query: jest.fn()
}));

jest.mock('../src/services/httpCheck.service', () => ({
    checkHttp: jest.fn()
}));

jest.mock('nodemailer', () => ({
    createTransport: jest.fn()
}));
const {
    sendToChannel,
    buildSlackPayload,
    buildWebhookPayload,
    buildEmailMessage,
    createSmtpTransporter,
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

describe('Slack notification formatting', () => {
    const monitor = {
        id: 12,
        name: 'Production API',
        url: 'https://example.com/health'
    };

    test.each([
        ['DOWN', 'is DOWN'],
        ['STILL_DOWN', 'is still DOWN'],
        ['UP', 'recovered'],
        ['FLAPPING', 'is flapping']
    ])('formats %s notifications', (type, expectedText) => {
        const payload = buildSlackPayload({ type, monitor });

        expect(payload.text).toContain(expectedText);
        expect(payload.text).toContain('Production API');
        expect(payload.text).toContain(monitor.url);
    });

    test('formats a stable DOWN notification', () => {
        const payload = buildSlackPayload({
            type: 'STABLE',
            monitor,
            currentStatus: 'DOWN'
        });

        expect(payload.text).toContain('has stabilized, but is DOWN');
        expect(payload.text).toContain('Alerts for this monitor have resumed.');
    });

    test('formats a stable UP notification', () => {
        const payload = buildSlackPayload({
            type: 'STABLE',
            monitor,
            currentStatus: 'UP'
        });

        expect(payload.text).toContain('has stabilized and is UP');
    });

    test('escapes Slack special characters in monitor details and errors', () => {
        const payload = buildSlackPayload({
            type: 'DOWN',
            monitor: {
                name: 'API <production> & staging',
                url: 'https://example.com/?a=1&b=2'
            },
            errorMessage: 'Response <failed> & unavailable'
        });

        expect(payload.text).toContain('API &lt;production&gt; &amp; staging');
        expect(payload.text).toContain('https://example.com/?a=1&amp;b=2');
        expect(payload.text).toContain('Response &lt;failed&gt; &amp; unavailable');
    });

    test.each([
        [45, '45s'],
        [125, '2m'],
        [3660, '1h 1m'],
        [90000, '1d 1h']
    ])('formats downtime of %i seconds', (downForSeconds, expected) => {
        const payload = buildSlackPayload({
            type: 'UP',
            monitor,
            downForSeconds
        });

        expect(payload.text).toContain(`Downtime: ${expected}`);
    });

    test('includes response time and error details when provided', () => {
        const payload = buildSlackPayload({
            type: 'DOWN',
            monitor,
            responseTimeMs: 850,
            errorMessage: 'Connection timed out'
        });

        expect(payload.text).toContain('Response time: 850 ms');
        expect(payload.text).toContain('Reason: Connection timed out');
    });

    test('does not include response time for FLAPPING notifications', () => {
        const payload = buildSlackPayload({
            type: 'FLAPPING',
            monitor,
            transitions: 5,
            windowMinutes: 10,
            responseTimeMs: 850
        });

        expect(payload.text).toContain('5 state changes');
        expect(payload.text).not.toContain('Response time:');
    });
});

describe('webhook notification formatting', () => {
    const monitor = {
        id: 12,
        name: 'Production API',
        url: 'https://example.com/health'
    };

    test('includes flapping transition details', () => {
        const payload = buildWebhookPayload({
            type: 'FLAPPING',
            monitor,
            transitions: 5,
            windowMinutes: 10
        });

        expect(payload.flapping).toEqual({
            transitions: 5,
            window_minutes: 10
        });
    });

    test('includes the current status for stable notifications', () => {
        const payload = buildWebhookPayload({
            type: 'STABLE',
            monitor,
            currentStatus: 'DOWN'
        });

        expect(payload.current_status).toBe('DOWN');
    });

    test('uses a generated timestamp when occurredAt is missing', () => {
        const before = Date.now();
        const payload = buildWebhookPayload({ type: 'DOWN', monitor });
        const after = Date.now();

        const timestamp = Date.parse(payload.occurred_at);

        expect(Number.isNaN(timestamp)).toBe(false);
        expect(timestamp).toBeGreaterThanOrEqual(before);
        expect(timestamp).toBeLessThanOrEqual(after);
    });
});

describe('sendToChannel delivery', () => {
    const { checkHttp } = require('../src/services/httpCheck.service');

    beforeEach(() => {
        jest.clearAllMocks();
    });

    const event = {
        type: 'DOWN',
        monitor: {
            id: 12,
            name: 'Production API',
            url: 'https://example.com/health'
        },
        occurredAt: '2026-10-30T08:00:00.000Z'
    };

    test.each(['slack', 'webhook'])(
        'sends a JSON POST request for a %s channel',
        async (type) => {
            checkHttp.mockResolvedValueOnce({ statusCode: 200 });

            await sendToChannel({
                id: 1,
                type,
                name: 'Test channel',
                url: 'https://example.com/hooks/test'
            }, event);

            expect(checkHttp).toHaveBeenCalledWith(
                expect.objectContaining({
                    url: 'https://example.com/hooks/test',
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    timeout_ms: 5000
                })
            );

            const requestOptions = checkHttp.mock.calls[0][0];
            const payload = JSON.parse(requestOptions.body);

            if (type === 'slack') {
                expect(payload.text).toContain('Production API');
                expect(payload.text).toContain('is DOWN');
            } else {
                expect(payload).toMatchObject({
                    source: 'pulseiq',
                    event: 'DOWN',
                    monitor: event.monitor,
                    occurred_at: event.occurredAt
                });
            }
        }
    );

    test('throws when the destination responds with HTTP 503', async () => {
        checkHttp.mockResolvedValueOnce({ statusCode: 503 });

        await expect(
            sendToChannel({
                type: 'webhook',
                url: 'https://example.com/hooks/test'
            }, event)
        ).rejects.toThrow('Channel responded with HTTP 503');
    });

    test('propagates network errors from the HTTP checker', async () => {
        checkHttp.mockRejectedValueOnce(new Error('Connection refused'));

        await expect(
            sendToChannel({
                type: 'webhook',
                url: 'https://example.com/hooks/test'
            }, event)
        ).rejects.toThrow('Connection refused');
    });
});




describe('email notification delivery', () => {
    const nodemailer = require('nodemailer');
    const { checkHttp } = require('../src/services/httpCheck.service');

    const originalEnv = { ...process.env };

    let transporter;

    const event = {
        type: 'DOWN',
        message: 'Monitor health check failed',
        errorType: 'ECONNREFUSED',
        errorMessage: 'Connection refused',
        responseTimeMs: 1200,
        statusCode: 503,
        downForSeconds: 125,
        monitor: {
            id: 12,
            name: 'Production API',
            url: 'https://example.com/health'
        },
        occurredAt: '2026-10-30T08:00:00.000Z'
    };

    beforeEach(() => {
        jest.clearAllMocks();

        process.env.SMTP_HOST = 'smtp.example.com';
        process.env.SMTP_PORT = '587';
        process.env.SMTP_SECURE = 'false';
        process.env.SMTP_USER = 'pulseiq@example.com';
        process.env.SMTP_PASS = 'test-password';
        process.env.SMTP_FROM = 'PulseIQ <pulseiq@example.com>';

        transporter = {
            sendMail: jest.fn().mockResolvedValue({ messageId: 'test-message-id' }),
            close: jest.fn()
        };

        nodemailer.createTransport.mockReturnValue(transporter);
    });

    afterAll(() => {
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
    });

    test('builds a DOWN email with monitor and failure details', () => {
        const message = buildEmailMessage(event);

        expect(message.subject).toBe(
            '[PulseIQ] Monitor DOWN: Production API'
        );

        expect(message.text).toContain('Monitor: Production API');
        expect(message.text).toContain('URL: https://example.com/health');
        expect(message.text).toContain('Message: Monitor health check failed');
        expect(message.text).toContain('Error type: ECONNREFUSED');
        expect(message.text).toContain('Reason: Connection refused');
        expect(message.text).toContain('Response time: 1200 ms');
        expect(message.text).toContain('HTTP status code: 503');
        expect(message.text).toContain('Occurred at: 2026-10-30T08:00:00.000Z');
    });

    test.each([
        ['STILL_DOWN', '[PulseIQ] Monitor still DOWN: Production API'],
        ['UP', '[PulseIQ] Monitor recovered: Production API'],
        ['FLAPPING', '[PulseIQ] Monitor flapping: Production API'],
        ['STABLE', '[PulseIQ] Monitor stable: Production API'],
        ['CERTIFICATE_EXPIRING', '[PulseIQ] SSL certificate expiring: Production API'],
        ['CERTIFICATE_EXPIRED', '[PulseIQ] SSL certificate expired: Production API']
    ])('formats the %s email subject', (type, expectedSubject) => {
        expect(buildEmailMessage({
            ...event,
            type
        }).subject).toBe(expectedSubject);
    });

    test('includes certificate expiry information in the email body', () => {
        const message = buildEmailMessage({
            ...event,
            type: 'CERTIFICATE_EXPIRING',
            certificateExpiresAt: '2026-11-05T00:00:00.000Z',
            certificateDaysRemaining: 5
        });

        expect(message.text).toContain(
            'Certificate expires: 2026-11-05T00:00:00.000Z'
        );
        expect(message.text).toContain('Certificate days remaining: 5');
    });

    test('includes flapping details in the email body', () => {
        const message = buildEmailMessage({
            ...event,
            type: 'FLAPPING',
            transitions: 6,
            windowMinutes: 10
        });

        expect(message.text).toContain('State changes: 6');
        expect(message.text).toContain('Detection window: 10 minutes');
    });

    test('creates an authenticated SMTP transporter with configured options', () => {
        createSmtpTransporter();

        expect(nodemailer.createTransport).toHaveBeenCalledWith(
            expect.objectContaining({
                host: 'smtp.example.com',
                port: 587,
                secure: false,
                auth: {
                    user: 'pulseiq@example.com',
                    pass: 'test-password'
                },
                connectionTimeout: 5000,
                greetingTimeout: 5000,
                socketTimeout: 5000
            })
        );
    });

    test('supports secure SMTP without authentication', () => {
        delete process.env.SMTP_USER;
        delete process.env.SMTP_PASS;
        process.env.SMTP_PORT = '465';
        process.env.SMTP_SECURE = 'true';

        createSmtpTransporter();

        expect(nodemailer.createTransport).toHaveBeenCalledWith(
            expect.objectContaining({
                host: 'smtp.example.com',
                port: 465,
                secure: true
            })
        );

        expect(nodemailer.createTransport.mock.calls[0][0]).not.toHaveProperty('auth');
    });

    test('rejects missing SMTP host or sender address', () => {
        delete process.env.SMTP_HOST;

        expect(() => createSmtpTransporter()).toThrow(
            'Email delivery is not configured'
        );

        process.env.SMTP_HOST = 'smtp.example.com';
        delete process.env.SMTP_FROM;

        expect(() => createSmtpTransporter()).toThrow(
            'Email delivery is not configured'
        );
    });

    test.each(['0', '65536', 'invalid', '587.5'])(
        'rejects invalid SMTP port %s',
        (port) => {
            process.env.SMTP_PORT = port;

            expect(() => createSmtpTransporter()).toThrow(
                'SMTP_PORT must be a valid port'
            );
        }
    );

    test('rejects incomplete SMTP credentials', () => {
        delete process.env.SMTP_PASS;

        expect(() => createSmtpTransporter()).toThrow(
            'SMTP_USER and SMTP_PASS must both be configured'
        );
    });

    test('sends an email to the configured recipient and closes the transporter', async () => {
        await sendToChannel({
            id: 3,
            type: 'email',
            name: 'Operations email',
            email: 'alerts@example.com'
        }, event);

        expect(nodemailer.createTransport).toHaveBeenCalledTimes(1);

        expect(transporter.sendMail).toHaveBeenCalledWith({
            from: 'PulseIQ <pulseiq@example.com>',
            to: 'alerts@example.com',
            subject: '[PulseIQ] Monitor DOWN: Production API',
            text: expect.stringContaining('Monitor: Production API')
        });

        expect(transporter.close).toHaveBeenCalledTimes(1);
        expect(checkHttp).not.toHaveBeenCalled();
    });

    test('rejects an email channel without a recipient', async () => {
        await expect(
            sendToChannel({
                type: 'email',
                email: ''
            }, event)
        ).rejects.toThrow('Email channel has no recipient address.');

        expect(nodemailer.createTransport).not.toHaveBeenCalled();
    });

    test('closes the transporter when SMTP delivery fails', async () => {
        transporter.sendMail.mockRejectedValueOnce(
            new Error('SMTP connection failed')
        );

        await expect(
            sendToChannel({
                type: 'email',
                email: 'alerts@example.com'
            }, event)
        ).rejects.toThrow('SMTP connection failed');

        expect(transporter.close).toHaveBeenCalledTimes(1);
        expect(checkHttp).not.toHaveBeenCalled();
    });
});


describe('notifyUser email channel delivery', () => {
    const db = require('../src/config/db');
    const nodemailer = require('nodemailer');
    const { checkHttp } = require('../src/services/httpCheck.service');

    const originalEnv = { ...process.env };

    let transporter;

    beforeEach(() => {
        jest.clearAllMocks();

        process.env.SMTP_HOST = 'smtp.example.com';
        process.env.SMTP_PORT = '587';
        process.env.SMTP_FROM = 'PulseIQ <pulseiq@example.com>';

        transporter = {
            sendMail: jest.fn().mockResolvedValue({ messageId: 'email-test' }),
            close: jest.fn()
        };

        nodemailer.createTransport.mockReturnValue(transporter);
    });

    afterAll(() => {
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
    });

    test('loads and delivers to an active email channel', async () => {
        db.query.mockResolvedValueOnce({
            rows: [
                {
                    id: 8,
                    type: 'email',
                    name: 'Operations Email',
                    url: null,
                    email: 'alerts@example.com'
                }
            ]
        });

        const results = await notifyUser(7, {
            type: 'DOWN',
            monitor: {
                id: 12,
                name: 'Production API',
                url: 'https://example.com/health'
            },
            occurredAt: '2026-10-30T08:00:00.000Z'
        });

        expect(db.query).toHaveBeenCalledWith(
            expect.stringContaining('SELECT id, type, name, url, email'),
            [7]
        );

        expect(nodemailer.createTransport).toHaveBeenCalledTimes(1);
        expect(transporter.sendMail).toHaveBeenCalledWith(
            expect.objectContaining({
                to: 'alerts@example.com',
                subject: '[PulseIQ] Monitor DOWN: Production API'
            })
        );

        expect(transporter.close).toHaveBeenCalledTimes(1);
        expect(checkHttp).not.toHaveBeenCalled();

        expect(results).toEqual([
            { channel_id: 8, ok: true, error: null }
        ]);
    });
});
