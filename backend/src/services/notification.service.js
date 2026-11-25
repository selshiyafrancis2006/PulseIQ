const db = require('../config/db');
const { checkHttp } = require('./httpCheck.service');
const nodemailer = require('nodemailer');
const { decryptUrl } = require('./notificationChannelCrypto.service');

const SEND_TIMEOUT_MS = 5000;

const {
    isHostMetricEvent,
    buildHostMetricSlack,
    buildHostMetricWebhook,
    buildHostMetricEmail
} = require('./hostMetricEvents');

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
    if (isHostMetricEvent(event)) return buildHostMetricSlack(event);

    const name = escapeSlack(event.monitor?.name);
    const url = escapeSlack(event.monitor?.url);
    const hostName = escapeSlack(event.host?.name || 'Unknown host');
    const lines = [];

    switch (event.type) {
        case 'HOST_OFFLINE':
            lines.push(`:red_circle: *${hostName}* is OFFLINE`);
            break;
        case 'HOST_RECOVERED':
            lines.push(`:large_green_circle: *${hostName}* recovered`);
            break;
        case 'DOWN':
            lines.push(`:red_circle: *${name}* is DOWN`);
            break;
        case 'STILL_DOWN':
            lines.push(`:red_circle: *${name}* is still DOWN`);
            break;
        case 'ESCALATION':
            lines.push(`:rotating_light: *${name}* escalation stage ${event.escalationStage}`);
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
        case 'METRIC_ALERT':
            lines.push(
                `${event.severity === 'Critical' ? ':red_circle:' : ':warning:'} *${escapeSlack(event.host?.name)}* ${escapeSlack(event.metricLabel)} alert (${escapeSlack(event.severity)})`
            );
            if (event.message) lines.push(escapeSlack(event.message));
            break;
        case 'METRIC_RECOVERED':
            lines.push(`:large_green_circle: *${escapeSlack(event.host?.name)}* ${escapeSlack(event.metricLabel)} recovered`);
            if (event.message) lines.push(escapeSlack(event.message));
            break;
        
        case "SYSTEM_ROLLUP_STALE":
            lines.push(`:warning: *PulseIQ ${escapeSlack(event.jobName)} rollup is STALE*`);
            if (event.message) lines.push(escapeSlack(event.message));
            if (event.lastSuccessAt) lines.push(`Last successful run: ${event.lastSuccessAt}`);
            if (event.staleAfterSeconds != null) lines.push(`Stale threshold: ${event.staleAfterSeconds}s`);
            break;
        case "SYSTEM_ROLLUP_RECOVERED":
            lines.push(`:large_green_circle: *PulseIQ ${escapeSlack(event.jobName)} rollup recovered*`);
            if (event.message) lines.push(escapeSlack(event.message));
            if (event.lastSuccessAt) lines.push(`Last successful run: ${event.lastSuccessAt}`);
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

    if (event.type === 'ESCALATION') {
        lines.push(event.message || 'The monitor remains DOWN.');
        if (event.downForSeconds != null) {
            lines.push(`Outage duration: ${formatDuration(event.downForSeconds)}`);
        }
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
    if (isHostMetricEvent(event)) return buildHostMetricWebhook(event);

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

    if (event.host) {
        payload.host = event.host;
    }

    if (event.downForSeconds != null) {
        payload.down_for_seconds = event.downForSeconds;
    }

    if (event.type === 'ESCALATION') {
        payload.escalation = {
            stage: event.escalationStage ?? null,
            down_for_seconds: event.downForSeconds ?? null
        };
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

    if (event.type === 'SYSTEM_ROLLUP_STALE' ||
        event.type === 'SYSTEM_ROLLUP_RECOVERED') {
        payload.job_name = event.jobName ?? null;
        payload.last_success_at = event.lastSuccessAt ?? null;
        payload.stale_after_seconds = event.staleAfterSeconds ?? null;
    }

    if (event.type === 'METRIC_ALERT' || event.type === 'METRIC_RECOVERED') {
        payload.host = event.host ?? null;
        payload.metric = {
            name: event.metricName ?? null,
            value: event.value ?? null,
            threshold: event.threshold ?? null,
            operator: event.operator ?? null,
            severity: event.severity ?? null,
            unit: event.unit ?? null
        };
    }

    
    return payload;
}

function buildEmailMessage(event) {
    if (isHostMetricEvent(event)) return buildHostMetricEmail(event);

    const monitorName = event.monitor?.name || 'PulseIQ monitor';
    const monitorUrl = event.monitor?.url || '';
    const hostName = event.host?.name || 'Unknown host';
    const isHostLifecycleEvent =
        event.type === 'HOST_OFFLINE' ||
        event.type === 'HOST_RECOVERED';
    const subjectPrefix = '[PulseIQ]';

    let subject;

    switch (event.type) {
        case 'HOST_OFFLINE':
            subject = `${subjectPrefix} Host OFFLINE: ${hostName}`;
            break;
        case 'HOST_RECOVERED':
            subject = `${subjectPrefix} Host recovered: ${hostName}`;
            break;
        case 'DOWN':
            subject = `${subjectPrefix} Monitor DOWN: ${monitorName}`;
            break;
        case 'STILL_DOWN':
            subject = `${subjectPrefix} Monitor still DOWN: ${monitorName}`;
            break;
        case 'ESCALATION':
            subject = `${subjectPrefix} Monitor escalation stage ${event.escalationStage}: ${monitorName}`;
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
        case 'METRIC_ALERT':
            subject = `${subjectPrefix} ${event.severity || 'Alert'}: ${event.metricLabel} on ${event.host?.name}`;
            break;
        case 'METRIC_RECOVERED':
            subject = `${subjectPrefix} Recovered: ${event.metricLabel} on ${event.host?.name}`;
            break;
        
        case 'SYSTEM_ROLLUP_STALE':
            subject = `${subjectPrefix} Rollup stale: ${event.jobName || "unknown"}`;
            break;
        case 'SYSTEM_ROLLUP_RECOVERED':
            subject = `${subjectPrefix} Rollup recovered: ${event.jobName || "unknown"}`;
            break;
        default:
            subject = `${subjectPrefix} Test notification`;
    }

    const isSystemRollupEvent =
        event.type === 'SYSTEM_ROLLUP_STALE' ||
        event.type === 'SYSTEM_ROLLUP_RECOVERED';

    const lines = [
        `PulseIQ notification: ${event.type}`,
        ''
    ];

    const isMetricEvent =
        event.type === 'METRIC_ALERT' ||
        event.type === 'METRIC_RECOVERED';

    if (isMetricEvent) {
        lines.push(`Host: ${event.host?.name ?? 'Unknown'}`);
        lines.push(`Metric: ${event.metricLabel ?? event.metricName}`);
        if (event.valueText) lines.push(`Value: ${event.valueText}`);
        if (event.type === 'METRIC_ALERT' && event.thresholdText) {
            lines.push(`Rule: ${event.operator} ${event.thresholdText}`);
        }
        if (event.type === 'METRIC_ALERT' && event.severity) {
            lines.push(`Severity: ${event.severity}`);
        }
    } else if (isSystemRollupEvent) {
        lines.push(`Rollup job: ${event.jobName || 'Unknown'}`);
        if (event.lastSuccessAt) {
            lines.push(`Last successful run: ${event.lastSuccessAt}`);
        }
        if (event.staleAfterSeconds != null) {
            lines.push(`Stale threshold: ${event.staleAfterSeconds} seconds`);
        }
    } else if (isHostLifecycleEvent) {
        lines.push(`Host: ${hostName}`);
    } else {
        lines.push(`Monitor: ${monitorName}`);
    }
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

    if (event.type === 'ESCALATION') {
        lines.push(`Escalation stage: ${event.escalationStage ?? 'Unknown'}`);
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

function getSystemAlertChannels() {
    const channels = [];

    const emails = (process.env.PULSEIQ_SYSTEM_ALERT_EMAILS || '')
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean);

    for (const email of new Set(emails)) {
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            channels.push({
                type: 'invalid',
                name: 'System alert email',
                error: 'Invalid system alert email address.'
            });
        } else {
            channels.push({ type: 'email', email });
        }
    }

    const destinations = [
        { env: 'PULSEIQ_SYSTEM_ALERT_WEBHOOKS', type: 'webhook' },
        { env: 'PULSEIQ_SYSTEM_ALERT_SLACK_WEBHOOKS', type: 'slack' }
    ];

    for (const destination of destinations) {
        const urls = (process.env[destination.env] || '')
            .split(',')
            .map((value) => value.trim())
            .filter(Boolean);

        for (const url of new Set(urls)) {
            let parsed;

            try {
                parsed = new URL(url);
            } catch {
                channels.push({
                    type: 'invalid',
                    name: destination.env,
                    error: `Invalid URL in ${destination.env}.`
                });
                continue;
            }

            if (parsed.protocol !== 'https:' || parsed.username || parsed.password) {
                channels.push({
                    type: 'invalid',
                    name: destination.env,
                    error: `Destination in ${destination.env} must be HTTPS without embedded credentials.`
                });
                continue;
            }

            channels.push({ type: destination.type, url });
        }
    }

    return channels;
}

async function sendSystemAlert(event) {
    const channels = getSystemAlertChannels();

    if (channels.length === 0) {
        return {
            configured: false,
            delivered: 0,
            failed: 0,
            results: []
        };
    }

    const results = await Promise.all(channels.map(async (channel) => {
        try {
            if (channel.type === 'invalid') {
                throw new Error(channel.error);
            }

            await sendToChannel(channel, event);

            return { type: channel.type, ok: true, error: null };
        } catch (err) {
            console.error('System alert delivery failed:', err.message);

            return {
                type: channel.type,
                ok: false,
                error: err.message
            };
        }
    }));

    return {
        configured: true,
        delivered: results.filter((result) => result.ok).length,
        failed: results.filter((result) => !result.ok).length,
        results
    };
}
// Fan out to every active channel the user owns. Never throws:
// a broken channel must not break monitor checking.
async function notifyUser(userId, event, channelIdsOverride = null, bypassMonitorRouting = false) {
    let channels;

    try {
        const result = await db.query(
            `SELECT id, type, name, url, email
             FROM notification_channels
             WHERE user_id = $1
               AND is_active = true
               AND (
                   NOT $4::BOOLEAN
                   OR $3::INTEGER[] IS NULL
                   OR notification_channels.id = ANY($3::INTEGER[])
               )
               AND (
                   $4::BOOLEAN
                   OR (
                       $2::INTEGER IS NULL
                       OR NOT EXISTS (
                           SELECT 1
                           FROM monitor_notification_settings
                           WHERE monitor_id = $2
                       )
                       OR EXISTS (
                           SELECT 1
                           FROM monitor_notification_settings
                           WHERE monitor_id = $2
                             AND routing_mode = 'ALL'
                       )
                       OR EXISTS (
                           SELECT 1
                           FROM monitor_notification_settings settings
                           JOIN monitor_notification_channels selected
                             ON selected.monitor_id = settings.monitor_id
                           WHERE settings.monitor_id = $2
                             AND settings.routing_mode = 'SELECTED'
                             AND selected.channel_id = notification_channels.id
                       )
                   )
               )
             ORDER BY id`,
            [
                userId,
                event.monitor?.id ?? null,
                channelIdsOverride,
                bypassMonitorRouting
            ]
        );
        channels = result.rows;
    } catch (error) {
        console.error('Failed to load notification channels:', error);
        return [];
    }

    const settled = await Promise.allSettled(
        // async so a URL that cannot be decrypted rejects only its own
        // channel instead of throwing out of notifyUser.
        channels.map(async (channel) => {
            const deliveryChannel = channel.type === 'email'
                ? channel
                : { ...channel, url: decryptUrl(channel.url) };

            return sendToChannel(deliveryChannel, event);
        })
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
    sendSystemAlert,
    getSystemAlertChannels,
    sendToChannel,
    notifyUser,
    buildSlackPayload,
    buildWebhookPayload,
    buildEmailMessage,
    createSmtpTransporter
};
