const {
    checkDns,
    validateDnsTarget,
    DNS_RESOLVERS
} = require('../src/services/dnsCheck.service');

describe('validateDnsTarget', () => {
    test('normalizes the hostname and record type', () => {
        expect(validateDnsTarget(' Example.com. ', 'a')).toEqual({
            hostname: 'Example.com',
            recordType: 'A'
        });
    });

    test.each([
        '',
        'localhost',
        'server.local',
        'server.internal',
        'example..com',
        '-bad.example.com',
        'bad-.example.com',
        'example.com/path',
        '192.0.2.1'
    ])('rejects invalid hostname %p', hostname => {
        expect(() => validateDnsTarget(hostname, 'A')).toThrow();
    });

        test('continues rejecting internal hostnames when private monitor targets are enabled', () => {
        const originalSetting = process.env.PULSEIQ_ALLOW_PRIVATE_TARGETS;

        process.env.PULSEIQ_ALLOW_PRIVATE_TARGETS = 'true';

        try {
            expect(() => validateDnsTarget('server.local', 'A')).toThrow(
                'DNS monitor requires a valid public hostname'
            );

            expect(() => validateDnsTarget('server.internal', 'A')).toThrow(
                'DNS monitor requires a valid public hostname'
            );
        } finally {
            if (originalSetting === undefined) {
                delete process.env.PULSEIQ_ALLOW_PRIVATE_TARGETS;
            } else {
                process.env.PULSEIQ_ALLOW_PRIVATE_TARGETS = originalSetting;
            }
        }
    });

    test('rejects a missing hostname', () => {
        expect(() => validateDnsTarget(undefined, 'A'))
            .toThrow('DNS monitor hostname is required');
    });

    test('rejects unsupported record types', () => {
        expect(() => validateDnsTarget('example.com', 'SOA'))
            .toThrow('Unsupported DNS record type');
    });

    test('supports all six configured DNS record types', () => {
        expect(Object.keys(DNS_RESOLVERS)).toEqual([
            'A', 'AAAA', 'CNAME', 'MX', 'TXT', 'NS'
        ]);
    });
});

describe('checkDns', () => {
    test.each([
        ['A', 'resolve4', ['93.184.216.34']],
        ['AAAA', 'resolve6', ['2001:db8::1']],
        ['CNAME', 'resolveCname', ['alias.example.com']],
        ['MX', 'resolveMx', [{ exchange: 'mail.example.com', priority: 10 }]],
        ['TXT', 'resolveTxt', [['v=spf1 -all']]],
        ['NS', 'resolveNs', ['ns1.example.com']]
    ])('queries %s records and returns timing data', async (
        recordType,
        resolverMethod,
        records
    ) => {
        const resolve = jest.fn().mockResolvedValue(records);
        const resolver = { [resolverMethod]: resolve };

        const result = await checkDns(
            { dns_hostname: 'example.com', dns_record_type: recordType },
            { resolver }
        );

        expect(resolve).toHaveBeenCalledWith('example.com');
        expect(result.hostname).toBe('example.com');
        expect(result.recordType).toBe(recordType);
        expect(result.records).toEqual(records);
        expect(result.dnsTimeMs).toEqual(expect.any(Number));
        expect(result.responseTimeMs).toBe(result.dnsTimeMs);
    });

    test('defaults to A records', async () => {
        const resolve4 = jest.fn().mockResolvedValue(['93.184.216.34']);

        const result = await checkDns(
            { dns_hostname: 'example.com' },
            { resolver: { resolve4 } }
        );

        expect(resolve4).toHaveBeenCalledWith('example.com');
        expect(result.recordType).toBe('A');
    });

    test('rejects an empty record result as ENODATA', async () => {
        await expect(checkDns(
            { dns_hostname: 'example.com', dns_record_type: 'A' },
            { resolver: { resolve4: jest.fn().mockResolvedValue([]) } }
        )).rejects.toMatchObject({ code: 'ENODATA' });
    });

    test.each(['ENOTFOUND', 'ENODATA', 'EAI_AGAIN'])(
        'preserves DNS resolver error %s',
        async code => {
            const error = Object.assign(new Error('DNS lookup failed'), { code });
            const resolve4 = jest.fn().mockRejectedValue(error);

            await expect(checkDns(
                { dns_hostname: 'example.com', dns_record_type: 'A' },
                { resolver: { resolve4 } }
            )).rejects.toMatchObject({ code });
        }
    );

    test('rejects if the requested resolver method is unavailable', async () => {
        await expect(checkDns(
            { dns_hostname: 'example.com', dns_record_type: 'A' },
            { resolver: {} }
        )).rejects.toThrow('DNS resolver is unavailable');
    });
});
