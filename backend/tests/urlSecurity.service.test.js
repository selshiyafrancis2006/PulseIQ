
const {
    isPublicIp,
    validatePublicHttpUrl
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
});
