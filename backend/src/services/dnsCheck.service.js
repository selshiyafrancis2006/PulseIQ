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

const INTERNAL_SUFFIXES = [
    '.localhost',
    '.local',
    '.internal',
    '.test',
    '.invalid'
];

function validateDnsTarget(hostname, recordType) {
    if (typeof hostname !== 'string' || !hostname.trim()) {
        throw new Error('DNS monitor hostname is required');
    }

    const normalizedHostname = hostname.trim().replace(/\.$/, '');

    if (
        normalizedHostname.length > 253 ||
        net.isIP(normalizedHostname) ||
        normalizedHostname.toLowerCase() === 'localhost' ||
        INTERNAL_SUFFIXES.some(suffix =>
            normalizedHostname.toLowerCase().endsWith(suffix)
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
    const validHostname = labels.length >= 2 && labels.every(labelIsValid);

    if (!validHostname) {
        throw new Error('DNS monitor requires a valid public hostname');
    }

    if (
        typeof recordType !== 'string' ||
        !Object.prototype.hasOwnProperty.call(DNS_RESOLVERS, recordType.toUpperCase())
    ) {
        throw new Error('Unsupported DNS record type');
    }

    return {
        hostname: normalizedHostname,
        recordType: recordType.toUpperCase()
    };
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
        const dnsTimeMs = Math.max(0, Math.round(performance.now() - startedAt));

        if (!Array.isArray(records) || records.length === 0) {
            const error = new Error('The requested DNS record was not found');
            error.code = 'ENODATA';
            throw error;
        }

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
