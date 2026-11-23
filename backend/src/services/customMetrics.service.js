const MAX_OBSERVATIONS = 200;
const MAX_TAGS = 10;
const MAX_FUTURE_SKEW_MS = 5 * 60 * 1000;

const UUID_PATTERN =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const METRIC_NAME_PATTERN =
    /^[a-zA-Z][a-zA-Z0-9_.-]{0,99}$/;

const TAG_KEY_PATTERN =
    /^[a-zA-Z][a-zA-Z0-9_.-]{0,63}$/;

function validateCollectedAt(value, now = Date.now()) {
    if (typeof value !== 'string') return null;

    const match = value.match(
        /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(Z|([+-])(\d{2}):(\d{2}))$/i
    );

    if (!match) return null;

    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const hour = Number(match[4]);
    const minute = Number(match[5]);
    const second = Number(match[6]);
    const offsetHour = Number(match[9] || 0);
    const offsetMinute = Number(match[10] || 0);

    const leapYear =
        year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);

    const daysInMonth = [
        31, leapYear ? 29 : 28, 31, 30, 31, 30,
        31, 31, 30, 31, 30, 31
    ];

    if (
        year < 1 ||
        month < 1 ||
        month > 12 ||
        day < 1 ||
        day > daysInMonth[month - 1] ||
        hour > 23 ||
        minute > 59 ||
        second > 59 ||
        offsetHour > 23 ||
        offsetMinute > 59
    ) {
        return null;
    }

    const date = new Date(value);

    if (
        Number.isNaN(date.getTime()) ||
        date.getTime() > now + MAX_FUTURE_SKEW_MS
    ) {
        return null;
    }

    return date.toISOString();
}

function sanitizeTags(raw) {
    if (raw === undefined || raw === null) return {};

    if (
        typeof raw !== 'object' ||
        Array.isArray(raw) ||
        Object.getPrototypeOf(raw) !== Object.prototype
    ) {
        return null;
    }

    const entries = Object.entries(raw);

    if (entries.length > MAX_TAGS) return null;

    const tags = {};

    for (const [key, value] of entries) {
        if (
            !TAG_KEY_PATTERN.test(key) ||
            ['__proto__', 'constructor', 'prototype'].includes(key)
        ) {
            return null;
        }

        if (typeof value === 'string') {
            if (value.length > 128) return null;
            tags[key] = value;
        } else if (
            typeof value === 'number' &&
            Number.isFinite(value)
        ) {
            tags[key] = value;
        } else if (typeof value === 'boolean') {
            tags[key] = value;
        } else {
            return null;
        }
    }

    return tags;
}

function validateCustomMetrics(body, now = Date.now()) {
    if (
        !body ||
        typeof body !== 'object' ||
        Array.isArray(body)
    ) {
        return { error: 'Invalid custom metrics payload' };
    }

    if (
        typeof body.sample_id !== 'string' ||
        !UUID_PATTERN.test(body.sample_id)
    ) {
        return { error: 'Invalid sample_id' };
    }

    const collectedAt = validateCollectedAt(body.collected_at, now);

    if (!collectedAt) {
        return { error: 'Invalid collected_at' };
    }

    if (
        !Array.isArray(body.metrics) ||
        body.metrics.length < 1 ||
        body.metrics.length > MAX_OBSERVATIONS
    ) {
        return {
            error: `metrics must contain between 1 and ${MAX_OBSERVATIONS} observations`
        };
    }

    const metrics = [];

    for (const observation of body.metrics) {
        if (
            !observation ||
            typeof observation !== 'object' ||
            Array.isArray(observation)
        ) {
            return { error: 'Invalid metric observation' };
        }

        const { metric_name, value, unit, tags } = observation;

        if (
            typeof metric_name !== 'string' ||
            !METRIC_NAME_PATTERN.test(metric_name)
        ) {
            return { error: 'Invalid metric_name' };
        }

        if (typeof value !== 'number' || !Number.isFinite(value)) {
            return { error: `Invalid value for metric: ${metric_name}` };
        }

        if (
            unit !== undefined &&
            unit !== null &&
            (typeof unit !== 'string' || unit.length > 32)
        ) {
            return { error: `Invalid unit for metric: ${metric_name}` };
        }

        const safeTags = sanitizeTags(tags);

        if (!safeTags) {
            return { error: `Invalid tags for metric: ${metric_name}` };
        }

        metrics.push({
            metric_name,
            value,
            unit: unit || null,
            tags: safeTags
        });
    }

    return {
        value: {
            sample_id: body.sample_id,
            collected_at: collectedAt,
            metrics
        }
    };
}

module.exports = {
    MAX_OBSERVATIONS,
    validateCollectedAt,
    sanitizeTags,
    validateCustomMetrics
};

