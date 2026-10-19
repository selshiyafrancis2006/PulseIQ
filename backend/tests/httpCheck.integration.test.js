
const http = require('node:http');
const { checkHttp } = require('../src/services/httpCheck.service');

describe('checkHttp real HTTP integration', () => {
    let server;
    let baseUrl;

    beforeEach(async () => {
        server = http.createServer((req, res) => {
            if (req.url === '/redirect') {
                res.writeHead(302, { Location: '/health' });
                res.end();
                return;
            }

            if (req.url === '/slow') {
                setTimeout(() => {
                    if (!res.destroyed) {
                        res.writeHead(200);
                        res.end('too late');
                    }
                }, 500);
                return;
            }

            if (req.url === '/large') {
                res.writeHead(200, {
                    'Content-Type': 'text/plain'
                });
                res.end('x'.repeat(1_100_000));
                return;
            }

            res.writeHead(200, {
                'Content-Type': 'text/plain'
            });
            res.end('healthy');
        });

        await new Promise((resolve, reject) => {
            server.once('error', reject);
            server.listen(0, '127.0.0.1', resolve);
        });

        baseUrl = `http://127.0.0.1:${server.address().port}`;
    });

    afterEach(async () => {
        if (server?.listening) {
            await new Promise(resolve => server.close(resolve));
        }
    });

    const allowTestServer = async input => {
        const url = new URL(input);

        if (
            url.hostname !== '127.0.0.1' ||
            !server ||
            !server.listening ||
            Number(url.port) !== server.address().port
        ) {
            throw new Error('Test URL is not the active local test server');
        }

        return {
            url,
            hostname: url.hostname,
            addresses: [{ address: '127.0.0.1' }]
        };
    };

    test('rejects loopback when using the production validator', async () => {
        await expect(
            checkHttp({ url: baseUrl })
        ).rejects.toThrow(
            'Monitor URL resolves to a non-public IP address'
        );
    });

    test('performs a real HTTP request', async () => {
        const result = await checkHttp(
            { url: `${baseUrl}/health` },
            { validateUrl: allowTestServer }
        );

        expect(result.statusCode).toBe(200);
        expect(result.body).toBe('healthy');
        expect(result.responseTimeMs).toEqual(expect.any(Number));
        expect(result.dnsTimeMs).toEqual(expect.any(Number));
expect(result.connectTimeMs).toEqual(expect.any(Number));
expect(result.ttfbTimeMs).toEqual(expect.any(Number));
expect(result.downloadTimeMs).toEqual(expect.any(Number));
    });

    test('follows a real redirect', async () => {
        const result = await checkHttp(
            { url: `${baseUrl}/redirect` },
            { validateUrl: allowTestServer }
        );

        expect(result.statusCode).toBe(200);
        expect(result.body).toBe('healthy');
        expect(result.finalUrl).toBe(`${baseUrl}/health`);
    });

    test('rejects an oversized response', async () => {
        await expect(
            checkHttp(
                { url: `${baseUrl}/large`, timeout_ms: 5000 },
                { validateUrl: allowTestServer }
            )
        ).rejects.toThrow(/maxContentLength/i);
    });

    test('times out a slow response', async () => {
        await expect(
            checkHttp(
                { url: `${baseUrl}/slow`, timeout_ms: 100 },
                { validateUrl: allowTestServer }
            )
        ).rejects.toThrow();
    });
});
