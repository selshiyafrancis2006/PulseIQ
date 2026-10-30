
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

const NAT64_PREFIX = [
    0x00, 0x64, 0xff, 0x9b,
    0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00
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

        // IPv4-mapped IPv6 addresses must pass IPv4 validation.
        if (
            parsed.kind() === 'ipv6' &&
            parsed.isIPv4MappedAddress()
        ) {
            return isPublicIp(parsed.toIPv4Address().toString());
        }

        if (parsed.kind() === 'ipv6') {
            const bytes = parsed.toByteArray();

            // Handle only the well-known NAT64 prefix: 64:ff9b::/96.
            // Validate the embedded IPv4 address using the same rules.
            if (
                NAT64_PREFIX.every(
                    (byte, index) => bytes[index] === byte
                )
            ) {
                const embeddedIpv4 = bytes.slice(12).join('.');
                return isPublicIp(embeddedIpv4);
            }
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

function isPrivateIp(address) {
    if (!net.isIP(address)) return false;

    try {
        const parsed = ipaddr.parse(address);

        if (
            parsed.kind() === 'ipv6' &&
            parsed.isIPv4MappedAddress()
        ) {
            return isPrivateIp(parsed.toIPv4Address().toString());
        }

        if (parsed.kind() === 'ipv6') {
            const bytes = parsed.toByteArray();

            if (
                NAT64_PREFIX.every(
                    (byte, index) => bytes[index] === byte
                )
            ) {
                return isPrivateIp(bytes.slice(12).join('.'));
            }

            return parsed.match(ipaddr.parse('fc00::'), 7);
        }

        return [
            ['10.0.0.0', 8],
            ['172.16.0.0', 12],
            ['192.168.0.0', 16]
        ].some(([base, prefix]) =>
            parsed.match(ipaddr.parse(base), prefix)
        );
    } catch {
        return false;
    }
}

function isAllowedMonitorIp(address, allowPrivateTargets) {
    return isPublicIp(address) ||
        (allowPrivateTargets && isPrivateIp(address));
}

function privateTargetsEnabled() {
    return process.env.PULSEIQ_ALLOW_PRIVATE_TARGETS === 'true';
}

async function validateHttpUrl(input, allowPrivateTargets = false) {
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
        BLOCKED_HOST_SUFFIXES.some(suffix =>
    hostname.endsWith(suffix) &&
    !(allowPrivateTargets && ['.local', '.internal'].includes(suffix))
) ||
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
      addresses.some(({ address }) =>
    !isAllowedMonitorIp(address, allowPrivateTargets)
)
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


function isValidDnsLabel(label) {
    if (!label || label.length > 63) return false;

    const isAlphaNumeric = code =>
        (code >= 97 && code <= 122) ||
        (code >= 48 && code <= 57);

    if (
        !isAlphaNumeric(label.charCodeAt(0)) ||
        !isAlphaNumeric(label.charCodeAt(label.length - 1))
    ) {
        return false;
    }

    for (const character of label) {
        const code = character.charCodeAt(0);
        if (!isAlphaNumeric(code) && code !== 45) return false;
    }

    return true;
}

async function validateTcpTarget(
    inputHost,
    inputPort,
    allowPrivateTargets = false
) {
    if (
        typeof inputHost !== 'string' ||
        inputHost.length === 0 ||
        inputHost.length > 253
    ) {
        throw new Error('Invalid TCP monitor hostname');
    }

    for (const character of inputHost) {
        const code = character.charCodeAt(0);

        if (
            code <= 32 ||
            code === 127 ||
            '/@?#\\'.includes(character)
        ) {
            throw new Error('Invalid TCP monitor hostname');
        }
    }

    if (
        !Number.isInteger(inputPort) ||
        inputPort < 1 ||
        inputPort > 65535
    ) {
        throw new Error('Invalid TCP monitor port');
    }

    let hostname = inputHost.toLowerCase();

    if (hostname.startsWith('[') && hostname.endsWith(']')) {
        hostname = hostname.slice(1, -1);
    } else if (hostname.includes('[') || hostname.includes(']')) {
        throw new Error('Invalid TCP monitor hostname');
    }

    if (
        !hostname ||
        hostname.includes('%') ||
        hostname === 'localhost' ||
        BLOCKED_HOST_SUFFIXES.some(suffix =>
    hostname.endsWith(suffix) &&
    !(
        allowPrivateTargets &&
        (suffix === '.local' || suffix === '.internal')
    )
)
    ) {
        throw new Error('TCP monitor hostname is not allowed');
    }

    if (net.isIP(hostname) === 0) {
        if (
            hostname.includes(':') ||
            hostname.startsWith('.') ||
            hostname.endsWith('.') ||
            hostname.split('.').some(label => !isValidDnsLabel(label))
        ) {
            throw new Error('Invalid TCP monitor hostname');
        }
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
            throw new Error('TCP monitor hostname could not be resolved');
        } finally {
            dnsTimeMs = Date.now() - dnsStartedAt;
        }
    }

    if (
        !addresses.length ||
        addresses.some(({ address }) => !isAllowedMonitorIp(address, allowPrivateTargets))
    ) {
        throw new Error(
            'TCP monitor hostname resolves to a non-public IP address'
        );
    }

    return { hostname, port: inputPort, addresses, dnsTimeMs };
}

async function validatePublicHttpUrl(input) {
    return validateHttpUrl(input, false);
}

async function validateMonitorHttpUrl(input) {
    return validateHttpUrl(input, privateTargetsEnabled());
}

async function validatePublicTcpTarget(inputHost, inputPort) {
    return validateTcpTarget(inputHost, inputPort, false);
}

async function validateMonitorTcpTarget(inputHost, inputPort) {
    return validateTcpTarget(
        inputHost,
        inputPort,
        privateTargetsEnabled()
    );
}

module.exports = {
    validatePublicHttpUrl,
    validatePublicTcpTarget,
    validateMonitorHttpUrl,
    validateMonitorTcpTarget,
    isPublicIp,
    isPrivateIp
};
