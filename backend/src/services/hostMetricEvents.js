// Notification events for host metric alert rules (CPU, memory, disk, network).
//
// notification.service.js hands any event whose type starts with HOST_METRIC_
// to the builders in this file, so the existing Slack, webhook and email
// channels can carry host alerts without changing how monitors are notified.

const HOST_METRIC_ALERT = 'HOST_METRIC_ALERT';
const HOST_METRIC_RECOVERED = 'HOST_METRIC_RECOVERED';

const { getMetric } = require('../config/metricRegistry');

function isHostMetricEvent(event) {
    return Boolean(
        event &&
        typeof event.type === 'string' &&
        event.type.startsWith('HOST_METRIC_')
    );
}

function formatValue(value, unit) {
    const number = Number(value);

    if (!Number.isFinite(number)) return 'n/a';

    return `${Math.round(number * 100) / 100}${unit}`;
}

// Builds the event object that notifyUser() sends.
function buildHostMetricEvent({ type, host, rule, value, severity }) {
    const metric = getMetric(rule.metric_name);
    const label = metric?.label || rule.metric_name;
    const unit = metric?.unit
        ? (metric.unit === '%' ? '%' : ` ${metric.unit}`)
        : '';

    const isAlert = type === HOST_METRIC_ALERT;
    const valueText = formatValue(value, unit);
    const thresholdText = formatValue(rule.threshold, unit);

    return {
        type,
        host: { id: host.id, name: host.name },
        metricName: rule.metric_name,
        metricLabel: label,
        operator: rule.operator,
        value: Number(value),
        threshold: Number(rule.threshold),
        valueText,
        thresholdText,
        severity: isAlert ? severity : null,
        message: isAlert
            ? `${label} is ${valueText} (rule: ${rule.operator} ${thresholdText})`
            : `${label} is back to normal at ${valueText}`,
        occurredAt: new Date().toISOString()
    };
}

function escapeSlack(text) {
    return String(text ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

function buildHostMetricSlack(event) {
    const host = escapeSlack(event.host?.name);
    const metric = escapeSlack(event.metricLabel);
    const lines = [];

    if (event.type === HOST_METRIC_ALERT) {
        const icon = event.severity === 'Critical'
            ? ':red_circle:'
            : ':warning:';

        lines.push(`${icon} *${host}*: ${metric} alert (${escapeSlack(event.severity)})`);
        lines.push(
            `${metric}: ${escapeSlack(event.valueText)} ` +
            `(rule: ${escapeSlack(event.operator)} ${escapeSlack(event.thresholdText)})`
        );
    } else {
        lines.push(`:large_green_circle: *${host}*: ${metric} recovered`);
        lines.push(`${metric} is back to normal at ${escapeSlack(event.valueText)}`);
    }

    return { text: lines.join('\n') };
}

function buildHostMetricWebhook(event) {
    return {
        source: 'pulseiq',
        event: event.type,
        host: event.host ?? null,
        metric: {
            name: event.metricName ?? null,
            value: event.value ?? null,
            threshold: event.threshold ?? null,
            operator: event.operator ?? null
        },
        severity: event.severity ?? null,
        message: event.message ?? null,
        occurred_at: event.occurredAt ?? new Date().toISOString()
    };
}

function buildHostMetricEmail(event) {
    const hostName = event.host?.name || 'unknown host';
    const metric = event.metricLabel || 'Metric';

    const subject = event.type === HOST_METRIC_ALERT
        ? `[PulseIQ] ${event.severity || 'Alert'}: ${metric} on ${hostName}`
        : `[PulseIQ] Recovered: ${metric} on ${hostName}`;

    const lines = [
        `PulseIQ notification: ${event.type}`,
        '',
        `Host: ${hostName}`,
        `Metric: ${metric}`
    ];

    if (event.type === HOST_METRIC_ALERT) {
        lines.push(
            `Current value: ${event.valueText}`,
            `Rule: ${event.operator} ${event.thresholdText}`,
            `Severity: ${event.severity}`
        );
    } else {
        lines.push(`Current value: ${event.valueText}`);
    }

    lines.push(
        '',
        `Occurred at: ${event.occurredAt || new Date().toISOString()}`,
        '',
        'This notification was sent by PulseIQ.'
    );

    return { subject, text: lines.join('\n') };
}

module.exports = {
    HOST_METRIC_ALERT,
    HOST_METRIC_RECOVERED,
    isHostMetricEvent,
    buildHostMetricEvent,
    buildHostMetricSlack,
    buildHostMetricWebhook,
    buildHostMetricEmail
};