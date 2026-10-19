
const dns = require('node:dns').promises;
const net = require('node:net');
const ipaddr = require('ipaddr.js');

const BLOCKED_HOST_SUFFIXES = [
    '.localhost',
    '.local',
    '.internal',
    '.test',
    '.invalid',
    '.example'
];

function normalizeHostname(hostname) {
    return hostname.replace(/^\[|\]$/g, '').toLowerCase();
}

function isPublicIp(address) {
    if (!net.isIP(address)) {
        return false;
    }

    try {
        const parsed = ipaddr.parse(address);

        if (
            parsed.kind() === 'ipv6' &&
            parsed.isIPv4MappedAddress()
        ) {
            return isPublicIp(parsed.toIPv4Address().toString());
        }

        if (parsed.range() !== 'unicast') {
            return false;
        }

        if (parsed.kind() === 'ipv4') {
            const blockedRanges = [
                ['100.64.0.0', 10],
                ['198.18.0.0', 15]
            ];

            return !blockedRanges.some(([base, prefix]) =>
                parsed.match(ipaddr.parse(base), prefix)
            );
        }

        return parsed.match(ipaddr.parse('2000::'), 3);
    } catch {
        return false;
    }
}

async function validatePublicHttpUrl(input) {
    let url;

    try {
        url = new URL(input);
    } catch {
        throw new Error('Invalid monitor URL');
    }

    if (
        !['http:', 'https:'].includes(url.protocol) ||
        url.username ||
        url.password
    ) {
        throw new Error(
            'Only HTTP/HTTPS URLs without credentials are allowed'
        );
    }

    const hostname = normalizeHostname(url.hostname);

    if (
        !hostname ||
        hostname === 'localhost' ||
        BLOCKED_HOST_SUFFIXES.some(suffix => hostname.endsWith(suffix)) ||
        hostname.includes('%')
    ) {
        throw new Error('Monitor hostname is not allowed');
    }

    let dnsTimeMs = 0;
    let addresses;

    if (net.isIP(hostname)) {
        addresses = [{ address: hostname }];
        } else {
        const dnsStartedAt = Date.now();

        try {
            addresses = await dns.lookup(hostname, {
                all: true,
                verbatim: true
            });
        } catch {
            throw new Error('Monitor hostname could not be resolved');
        } finally {
            dnsTimeMs = Date.now() - dnsStartedAt;
        }
    }

    if (
        addresses.length === 0 ||
        addresses.some(({ address }) => !isPublicIp(address))
    ) {
        throw new Error(
            'Monitor URL resolves to a non-public IP address'
        );
    }

    return {
        url,
        hostname,
        addresses,
        dnsTimeMs
    };
}

module.exports = {
    validatePublicHttpUrl,
    isPublicIp
};
