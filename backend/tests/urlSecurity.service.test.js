
const {
    isPublicIp,
    validatePublicHttpUrl,
    validatePublicTcpTarget
} = require('../src/services/urlSecurity.service');

describe('urlSecurity.service', () => {
    describe('isPublicIp', () => {
        test.each([
            ['127.0.0.1', false],
            ['10.0.0.1', false],
            ['172.16.0.1', false],
            ['192.168.1.1', false],
            ['169.254.169.254', false],
            ['0.0.0.0', false],
            ['::1', false],
            ['fc00::1', false],
            ['fe80::1', false],
            ['::ffff:127.0.0.1', false],
            ['::ffff:10.0.0.1', false],

            ['64:ff9b::d7e:8ac9', true],
['64:ff9b::a00:1', false],
['64:ff9b::7f00:1', false],

            ['100.64.0.1', false],
            ['198.18.0.1', false],
            ['198.19.255.254', false],
            ['192.0.2.1', false],
            ['198.51.100.1', false],
            ['203.0.113.1', false],
            ['2001:db8::1', false],

            ['8.8.8.8', true],
            ['1.1.1.1', true],
            ['2606:4700:4700::1111', true],
            ['2001:4860:4860::8888', true],

            ['not-an-ip', false]
        ])('%s should be public: %s', (address, expected) => {
            expect(isPublicIp(address)).toBe(expected);
        });
    });

    describe('validatePublicHttpUrl', () => {
        test('rejects non-HTTP schemes', async () => {
            await expect(
                validatePublicHttpUrl('file:///etc/passwd')
            ).rejects.toThrow(
                'Only HTTP/HTTPS URLs without credentials are allowed'
            );
        });

        test('rejects URL credentials', async () => {
            await expect(
                validatePublicHttpUrl('https://user:pass@example.com')
            ).rejects.toThrow(
                'Only HTTP/HTTPS URLs without credentials are allowed'
            );
        });

        test.each([
            'http://localhost',
            'http://service.local',
            'http://service.internal',
            'http://service.test'
        ])('rejects internal hostname %s', async url => {
            await expect(
                validatePublicHttpUrl(url)
            ).rejects.toThrow('Monitor hostname is not allowed');
        });

        test.each([
            'http://127.0.0.1',
            'http://10.0.0.1',
            'http://192.168.1.1',
            'http://[::1]',
            'http://100.64.0.1',
            'http://198.18.0.1',
            'http://192.0.2.1',
            'http://[2001:db8::1]'
        ])('rejects non-public IP URL %s', async url => {
            await expect(
                validatePublicHttpUrl(url)
            ).rejects.toThrow(
                'Monitor URL resolves to a non-public IP address'
            );
        });
    });
    describe('validatePublicTcpTarget', () => {
        const dns = require('node:dns').promises;

        afterEach(() => {
            jest.restoreAllMocks();
        });

        test.each([0, -1, 65536, 1.5, '443', null])(
            'rejects invalid port %s',
            async port => {
                await expect(
                    validatePublicTcpTarget('example.com', port)
                ).rejects.toThrow('Invalid TCP monitor port');
            }
        );

        test.each([
            '',
            'bad host',
            'host/path',
            'host@example.com',
            '-bad.example.com',
            'bad-.example.com',
            'bad..example.com',
            'localhost',
            'service.local',
            'service.internal',
            'service.test',
            'service.invalid',
            'service.example'
        ])('rejects invalid or blocked hostname %s', async host => {
            await expect(
                validatePublicTcpTarget(host, 443)
            ).rejects.toThrow();
        });

        test.each([
            '127.0.0.1',
            '10.0.0.1',
            '192.168.1.1',
            '169.254.169.254',
            '::1',
            '[::1]',
            'fc00::1',
            '2001:db8::1'
        ])('rejects non-public IP %s', async host => {
            await expect(
                validatePublicTcpTarget(host, 443)
            ).rejects.toThrow(
                'TCP monitor hostname resolves to a non-public IP address'
            );
        });

        test.each([
            ['8.8.8.8', '8.8.8.8'],
            ['[2606:4700:4700::1111]', '2606:4700:4700::1111']
        ])('accepts public IP literal %s', async (host, expected) => {
            const result = await validatePublicTcpTarget(host, 443);

            expect(result.hostname).toBe(expected);
            expect(result.port).toBe(443);
            expect(result.addresses).toEqual([{ address: expected }]);
        });

        test('accepts hostname resolving to a public address', async () => {
            jest.spyOn(dns, 'lookup').mockResolvedValue([
                { address: '93.184.216.34', family: 4 }
            ]);

            const result = await validatePublicTcpTarget('example.com', 443);

            expect(result.hostname).toBe('example.com');
            expect(result.port).toBe(443);
            expect(result.addresses).toHaveLength(1);
            expect(dns.lookup).toHaveBeenCalledWith('example.com', {
                all: true,
                verbatim: true
            });
        });

        test('rejects hostname if DNS returns any private address', async () => {
            jest.spyOn(dns, 'lookup').mockResolvedValue([
                { address: '93.184.216.34', family: 4 },
                { address: '127.0.0.1', family: 4 }
            ]);

            await expect(
                validatePublicTcpTarget('example.com', 443)
            ).rejects.toThrow(
                'TCP monitor hostname resolves to a non-public IP address'
            );
        });

        test('rejects hostname when DNS resolution fails', async () => {
            jest.spyOn(dns, 'lookup').mockRejectedValue(
                new Error('DNS lookup failed')
            );

            await expect(
                validatePublicTcpTarget('unresolvable.example.net', 443)
            ).rejects.toThrow(
                'TCP monitor hostname could not be resolved'
            );
        });

        test('rejects hostname when DNS returns no addresses', async () => {
            jest.spyOn(dns, 'lookup').mockResolvedValue([]);

            await expect(
                validatePublicTcpTarget('example.com', 443)
            ).rejects.toThrow(
                'TCP monitor hostname resolves to a non-public IP address'
            );
        });
    });
});
