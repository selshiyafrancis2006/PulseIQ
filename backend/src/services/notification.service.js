const db = require('../config/db');
const { checkHttp } = require('./httpCheck.service');
const nodemailer = require('nodemailer');

const SEND_TIMEOUT_MS = 5000;

// Escape the three characters Slack treats specially in mrkdwn.
function escapeSlack(text) {
    return String(text ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

function formatDuration(totalSeconds) {
    const seconds = Math.max(0, Math.round(Number(totalSeconds) || 0));

    if (seconds < 60) return `${seconds}s`;

    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m`;

    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ${minutes % 60}m`;

    return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}

function buildSlackPayload(event) {
    const name = escapeSlack(event.monitor?.name);
    const url = escapeSlack(event.monitor?.url);
    const lines = [];

    switch (event.type) {
        case 'DOWN':
            lines.push(`:red_circle: *${name}* is DOWN`);
            break;
        case 'STILL_DOWN':
            lines.push(`:red_circle: *${name}* is still DOWN`);
            break;
        case 'UP':
            lines.push(`:large_green_circle: *${name}* recovered`);
            break;
        case 'FLAPPING':
            lines.push(`:warning: *${name}* is flapping`);
            break;
        case 'STABLE':
            lines.push(
                event.currentStatus === 'DOWN'
                    ? `:red_circle: *${name}* has stabilized, but is DOWN`
                    : `:large_green_circle: *${name}* has stabilized and is UP`
            );
            break;
        case 'CERTIFICATE_EXPIRING':
            lines.push(`:warning: *${name}* SSL certificate is expiring`);
            if (event.certificateDaysRemaining != null) {
                lines.push(`Days remaining: ${event.certificateDaysRemaining}`);
            }
            break;
        case 'CERTIFICATE_EXPIRED':
            lines.push(`:red_circle: *${name}* SSL certificate has EXPIRED`);
            break;
        default:
            lines.push(':test_tube: PulseIQ test notification');
    }

    if (url) lines.push(url);

    if (event.type === 'FLAPPING') {
        lines.push(
            `${event.transitions} state changes in the last ` +
            `${event.windowMinutes} minutes. Alerts for this monitor are ` +
            `paused until it is stable.`
        );
    }

    if (event.type === 'STABLE') {
        lines.push('Alerts for this monitor have resumed.');
    }

    if (event.errorMessage) {
        lines.push(`Reason: ${escapeSlack(event.errorMessage)}`);
    }

    if (event.downForSeconds != null) {
        lines.push(
            event.type === 'UP'
                ? `Downtime: ${formatDuration(event.downForSeconds)}`
                : `Down for: ${formatDuration(event.downForSeconds)}`
        );
    }

    if (event.type !== 'FLAPPING' && event.responseTimeMs != null) {
        lines.push(`Response time: ${event.responseTimeMs} ms`);
    }

    return { text: lines.join('\n') };
}

function buildWebhookPayload(event) {
    const payload = {
        source: 'pulseiq',
        event: event.type,
        monitor: event.monitor ?? null,
        message: event.message ?? null,
        error_type: event.errorType ?? null,
        error_message: event.errorMessage ?? null,
        response_time_ms: event.responseTimeMs ?? null,
        certificate_expires_at: event.certificateExpiresAt ?? null,
        certificate_days_remaining: event.certificateDaysRemaining ?? null,
        status_code: event.statusCode ?? null,
        occurred_at: event.occurredAt ?? new Date().toISOString()
    };

    if (event.downForSeconds != null) {
        payload.down_for_seconds = event.downForSeconds;
    }

    if (event.type === 'FLAPPING') {
        payload.flapping = {
            transitions: event.transitions ?? null,
            window_minutes: event.windowMinutes ?? null
        };
    }

    if (event.type === 'STABLE') {
        payload.current_status = event.currentStatus ?? null;
    }

    return payload;
}

function buildEmailMessage(event) {
    const monitorName = event.monitor?.name || 'PulseIQ monitor';
    const monitorUrl = event.monitor?.url || '';
    const subjectPrefix = '[PulseIQ]';

    let subject;

    switch (event.type) {
        case 'DOWN':
            subject = `${subjectPrefix} Monitor DOWN: ${monitorName}`;
            break;
        case 'STILL_DOWN':
            subject = `${subjectPrefix} Monitor still DOWN: ${monitorName}`;
            break;
        case 'UP':
            subject = `${subjectPrefix} Monitor recovered: ${monitorName}`;
            break;
        case 'FLAPPING':
            subject = `${subjectPrefix} Monitor flapping: ${monitorName}`;
            break;
        case 'STABLE':
            subject = `${subjectPrefix} Monitor stable: ${monitorName}`;
            break;
        case 'CERTIFICATE_EXPIRING':
            subject = `${subjectPrefix} SSL certificate expiring: ${monitorName}`;
            break;
        case 'CERTIFICATE_EXPIRED':
            subject = `${subjectPrefix} SSL certificate expired: ${monitorName}`;
            break;
        default:
            subject = `${subjectPrefix} Test notification`;
    }

    const lines = [
        `PulseIQ notification: ${event.type}`,
        '',
        `Monitor: ${monitorName}`
    ];

    if (monitorUrl) lines.push(`URL: ${monitorUrl}`);
    if (event.message) lines.push(`Message: ${event.message}`);
    if (event.errorType) lines.push(`Error type: ${event.errorType}`);
    if (event.errorMessage) lines.push(`Reason: ${event.errorMessage}`);

    if (event.responseTimeMs != null) {
        lines.push(`Response time: ${event.responseTimeMs} ms`);
    }

    if (event.statusCode != null) {
        lines.push(`HTTP status code: ${event.statusCode}`);
    }

    if (event.downForSeconds != null) {
        lines.push(
            `${event.type === 'UP' ? 'Downtime' : 'Down for'}: ` +
            formatDuration(event.downForSeconds)
        );
    }

    if (event.type === 'FLAPPING') {
        lines.push(
            `State changes: ${event.transitions ?? 'Unknown'}`,
            `Detection window: ${event.windowMinutes ?? 'Unknown'} minutes`
        );
    }

    if (event.type === 'STABLE') {
        lines.push(`Current status: ${event.currentStatus ?? 'Unknown'}`);
    }

    if (event.certificateExpiresAt) {
        lines.push(`Certificate expires: ${event.certificateExpiresAt}`);
    }

    if (event.certificateDaysRemaining != null) {
        lines.push(`Certificate days remaining: ${event.certificateDaysRemaining}`);
    }

    lines.push(
        '',
        `Occurred at: ${event.occurredAt || new Date().toISOString()}`,
        '',
        'This notification was sent by PulseIQ.'
    );

    return {
        subject,
        text: lines.join('\n')
    };
}

function createSmtpTransporter() {
    const {
        SMTP_HOST,
        SMTP_PORT = '587',
        SMTP_SECURE = 'false',
        SMTP_USER,
        SMTP_PASS
    } = process.env;

    if (!SMTP_HOST || !process.env.SMTP_FROM) {
        throw new Error(
            'Email delivery is not configured. Set SMTP_HOST and SMTP_FROM.'
        );
    }

    const port = Number(SMTP_PORT);

    if (!Number.isInteger(port) || port < 1 || port > 65535) {
        throw new Error('SMTP_PORT must be a valid port between 1 and 65535.');
    }

    if (Boolean(SMTP_USER) !== Boolean(SMTP_PASS)) {
        throw new Error('SMTP_USER and SMTP_PASS must both be configured.');
    }

    const secure = ['true', '1'].includes(
        String(SMTP_SECURE).toLowerCase()
    );

    const options = {
        host: SMTP_HOST,
        port,
        secure,
        connectionTimeout: SEND_TIMEOUT_MS,
        greetingTimeout: SEND_TIMEOUT_MS,
        socketTimeout: SEND_TIMEOUT_MS
    };

    if (SMTP_USER && SMTP_PASS) {
        options.auth = {
            user: SMTP_USER,
            pass: SMTP_PASS
        };
    }

    return nodemailer.createTransport(options);
}

async function sendEmail(channel, event) {
    if (!channel.email) {
        throw new Error('Email channel has no recipient address.');
    }

    const transporter = createSmtpTransporter();
    const message = buildEmailMessage(event);

    try {
        await transporter.sendMail({
            from: process.env.SMTP_FROM,
            to: channel.email,
            subject: message.subject,
            text: message.text
        });
    } finally {
        transporter.close();
    }
}

// Sends through checkHttp so webhook destinations get the same
// protection as monitor URLs: public-IP-only, DNS pinning,
// validated redirects and response-size limits.
async function sendToChannel(channel, event) {
    if (channel.type === 'email') {
        return sendEmail(channel, event);
    }

    const payload = channel.type === 'slack'
        ? buildSlackPayload(event)
        : buildWebhookPayload(event);

    const response = await checkHttp({
        url: channel.url,
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        timeout_ms: SEND_TIMEOUT_MS
    });

    if (response.statusCode < 200 || response.statusCode >= 300) {
        throw new Error(`Channel responded with HTTP ${response.statusCode}`);
    }
}

// Fan out to every active channel the user owns. Never throws:
// a broken channel must not break monitor checking.
async function notifyUser(userId, event) {
    let channels;

    try {
        const result = await db.query(
            `SELECT id, type, name, url, email
             FROM notification_channels
             WHERE user_id = $1 AND is_active = true
             ORDER BY id`,
            [userId]
        );
        channels = result.rows;
    } catch (error) {
        console.error('Failed to load notification channels:', error);
        return [];
    }

    const settled = await Promise.allSettled(
        channels.map((channel) => sendToChannel(channel, event))
    );

    return settled.map((outcome, index) => {
        const channel = channels[index];

        if (outcome.status === 'rejected') {
            console.error(
                `Notification failed (channel_id: ${channel.id}):`,
                outcome.reason?.message
            );
        }

        return {
            channel_id: channel.id,
            ok: outcome.status === 'fulfilled',
            error: outcome.status === 'rejected'
                ? outcome.reason?.message
                : null
        };
    });
}

module.exports = {
    sendToChannel,
    notifyUser,
    buildSlackPayload,
    buildWebhookPayload,
    buildEmailMessage,
    createSmtpTransporter
};
