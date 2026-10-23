
const http = require('node:http');
const { spawnSync } = require('node:child_process');
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

        test('handles a refused TCP connection without crashing the process', async () => {
        const unusedServer = http.createServer();

        await new Promise((resolve, reject) => {
            unusedServer.once('error', reject);
            unusedServer.listen(0, '127.0.0.1', resolve);
        });

        const unusedPort = unusedServer.address().port;

        await new Promise((resolve, reject) => {
            unusedServer.close(error => {
                if (error) reject(error);
                else resolve();
            });
        });

        await expect(
            checkHttp(
                { url: `http://127.0.0.1:${unusedPort}`, timeout_ms: 1000 },
                {
                    validateUrl: async input => ({
                        url: new URL(input),
                        hostname: '127.0.0.1',
                        addresses: [{ address: '127.0.0.1' }],
                        dnsTimeMs: 0
                    })
                }
            )
        ).rejects.toThrow();
    });

        test('handles an unreachable IPv6 HTTPS connection without crashing Node', () => {
        const script = `
            const { checkHttp } = require('./src/services/httpCheck.service');

            checkHttp(
                { url: 'https://example.com', timeout_ms: 1500 },
                {
                    validateUrl: async input => ({
                        url: new URL(input),
                        hostname: 'example.com',
                        addresses: [{ address: '2001:db8::1' }],
                        dnsTimeMs: 0
                    })
                }
            )
                .then(() => {
                    console.log('REQUEST_FINISHED');
                })
                .catch(() => {
                    console.log('REQUEST_FAILED');
                });
        `;

        const result = spawnSync(
            process.execPath,
            ['-e', script],
            {
                cwd: require('node:path').resolve(__dirname, '..'),
                encoding: 'utf8',
                timeout: 10000
            }
        );

        expect(result.error).toBeUndefined();
        expect(result.status).toBe(0);
        expect(result.stdout).toMatch(/REQUEST_(FINISHED|FAILED)/);
    });
});
