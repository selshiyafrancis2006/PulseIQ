
const dns = require('node:dns').promises;
const net = require('node:net');
const { performance } = require('node:perf_hooks');

const DNS_RESOLVERS = Object.freeze({
    A: 'resolve4',
    AAAA: 'resolve6',
    CNAME: 'resolveCname',
    MX: 'resolveMx',
    TXT: 'resolveTxt',
    NS: 'resolveNs'
});

const BLOCKED_SUFFIXES = [
    '.localhost',
    '.test',
    '.invalid'
];

const PRIVATE_SUFFIXES = [
    '.local',
    '.internal'
];

function privateTargetsEnabled() {
    return process.env.PULSEIQ_ALLOW_PRIVATE_TARGETS === 'true';
}

function validateDnsTarget(
    hostname,
    recordType,
    allowPrivateTargets = privateTargetsEnabled()
) {
    if (typeof hostname !== 'string' || !hostname.trim()) {
        throw new Error('DNS monitor hostname is required');
    }

    const normalizedHostname = hostname.trim().replace(/\.$/, '');
    const lowerHostname = normalizedHostname.toLowerCase();

    if (
        normalizedHostname.length > 253 ||
        net.isIP(normalizedHostname) ||
        lowerHostname === 'localhost' ||
        BLOCKED_SUFFIXES.some(suffix =>
            lowerHostname.endsWith(suffix)
        ) ||
        (
            !allowPrivateTargets &&
            PRIVATE_SUFFIXES.some(suffix =>
                lowerHostname.endsWith(suffix)
            )
        )
    ) {
        throw new Error('DNS monitor requires a valid public hostname');
    }

    const labels = normalizedHostname.split('.');
    const labelIsValid = label => {
        if (label.length < 1 || label.length > 63) return false;
        if (!/[a-zA-Z0-9]/.test(label[0])) return false;
        if (!/[a-zA-Z0-9]/.test(label[label.length - 1])) return false;

        for (const char of label) {
            if (!/[a-zA-Z0-9-]/.test(char)) return false;
        }

        return true;
    };

    const validHostname =
        labels.length >= 2 && labels.every(labelIsValid);

    if (!validHostname) {
        throw new Error('DNS monitor requires a valid public hostname');
    }

    if (
        typeof recordType !== 'string' ||
        !Object.prototype.hasOwnProperty.call(
            DNS_RESOLVERS,
            recordType.toUpperCase()
        )
    ) {
        throw new Error('Unsupported DNS record type');
    }

    return {
        hostname: normalizedHostname,
        recordType: recordType.toUpperCase()
    };
}

function normalizeDnsRecord(recordType, record) {
    switch (recordType) {
        case 'A':
        case 'AAAA':
            return String(record).toLowerCase();

        case 'CNAME':
        case 'NS':
            return String(record).trim().replace(/\.$/, '').toLowerCase();

        case 'MX':
            return `${Number(record.priority)} ${String(record.exchange)
                .trim()
                .replace(/\.$/, '')
                .toLowerCase()}`;

        case 'TXT':
            return Array.isArray(record) ? record.join('') : String(record);

        default:
            return String(record);
    }
}

function normalizeExpectedDnsRecord(recordType, value) {
    const normalized = String(value).trim();

    if (recordType === 'MX') {
        const match = normalized.match(/^(\d+)\s+(.+)$/);

        if (!match) {
            return normalized;
        }

        return normalizeDnsRecord(recordType, {
            priority: Number(match[1]),
            exchange: match[2]
        });
    }

    return normalizeDnsRecord(recordType, normalized);
}

function assertExpectedDnsValues(recordType, records, expectedValues) {
    if (!Array.isArray(expectedValues) || expectedValues.length === 0) {
        return;
    }

    const actualValues = new Set(
        records.map(record => normalizeDnsRecord(recordType, record))
    );

    const missingValues = expectedValues
        .map(value => String(value).trim())
        .filter(value => !actualValues.has(
            normalizeExpectedDnsRecord(recordType, value)
        ));

    if (missingValues.length > 0) {
        const error = new Error(
            `Expected DNS ${recordType} value(s) not found: ${missingValues.join(', ')}`
        );
        error.code = 'DNS_EXPECTED_VALUE_MISMATCH';
        throw error;
    }
}
async function checkDns(monitor, options = {}) {
    const { hostname, recordType } = validateDnsTarget(
        monitor?.dns_hostname,
        monitor?.dns_record_type || 'A'
    );

    const resolver = options.resolver || dns;
    const resolverMethod = DNS_RESOLVERS[recordType];
    const resolve = resolver[resolverMethod];

    if (typeof resolve !== 'function') {
        throw new Error('DNS resolver is unavailable');
    }

    const startedAt = performance.now();

    try {
        const records = await resolve.call(resolver, hostname);
        const dnsTimeMs = Math.max(
            0,
            Math.round(performance.now() - startedAt)
        );

        if (!Array.isArray(records) || records.length === 0) {
            const error = new Error('The requested DNS record was not found');
            error.code = 'ENODATA';
            throw error;
        }

        assertExpectedDnsValues(
            recordType,
            records,
            monitor?.dns_expected_values
        );

        return {
            hostname,
            recordType,
            records,
            dnsTimeMs,
            responseTimeMs: dnsTimeMs
        };
    } catch (error) {
        if (error?.code === 'ENODATA' || error?.code === 'ENOTFOUND') {
            throw error;
        }

        throw error;
    }
}

module.exports = {
    checkDns,
    validateDnsTarget,
    DNS_RESOLVERS
};
