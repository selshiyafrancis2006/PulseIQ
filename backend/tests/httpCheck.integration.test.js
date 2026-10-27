
const http = require('node:http');
const { spawnSync } = require('node:child_process');
const { checkHttp } = require('../src/services/httpCheck.service');
const fs = require('node:fs');
const https = require('node:https');
const path = require('node:path');
const os = require('node:os');

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


describe('checkHttp real HTTPS certificate integration', () => {
    let server;
    let baseUrl;
    let certificate;
    let certificateInfo;


    let fixtureDir;

    beforeAll(() => {
        fixtureDir = fs.mkdtempSync(
            path.join(os.tmpdir(), 'pulseiq-https-test-')
        );

        const candidates = [
            process.env.OPENSSL_BIN,
            'C:\\Program Files\\Git\\usr\\bin\\openssl.exe',
            'openssl'
        ].filter(Boolean);

        let openssl;
        for (const candidate of candidates) {
            const probe = spawnSync(candidate, ['version'], {
                encoding: 'utf8',
                windowsHide: true
            });

            if (!probe.error && probe.status === 0) {
                openssl = candidate;
                break;
            }
        }

        if (!openssl) {
            throw new Error(
                'OpenSSL is required to generate the HTTPS test certificate'
            );
        }

        const certPath = path.join(fixtureDir, 'cert.pem');
        const keyPath = path.join(fixtureDir, 'key.pem');

        const generated = spawnSync(openssl, [
            'req',
            '-x509',
            '-newkey', 'rsa:2048',
            '-sha256',
            '-nodes',
            '-keyout', keyPath,
            '-out', certPath,
            '-days', '30',
            '-subj', '/CN=example.com',
            '-addext', 'subjectAltName=DNS:example.com'
        ], {
            encoding: 'utf8',
            windowsHide: true
        });

        if (generated.error || generated.status !== 0) {
            throw new Error(
                `Failed to generate HTTPS test certificate: ${
                    generated.error?.message ||
                    generated.stderr ||
                    'OpenSSL failed'
                }`
            );
        }

        certificate = fs.readFileSync(certPath, 'utf8');
        const key = fs.readFileSync(keyPath, 'utf8');

        certificateInfo = new (require('node:crypto').X509Certificate)(
            certificate
        );

        server = https.createServer({ key, cert: certificate }, (req, res) => {
            res.writeHead(200, { 'Content-Type': 'text/plain' });
            res.end('secure');
        });
    });

    beforeAll(async () => {
        await new Promise((resolve, reject) => {
            server.once('error', reject);
            server.listen(0, '127.0.0.1', resolve);
        });

        baseUrl = `https://example.com:${server.address().port}`;
    });

    afterAll(async () => {
        if (server?.listening) {
            await new Promise(resolve => server.close(resolve));
        }

        if (fixtureDir) {
            fs.rmSync(fixtureDir, { recursive: true, force: true });
        }
    });

    const validateTestHttpsServer = async input => {
        const url = new URL(input);

        if (
            !['example.com', 'wrong.example.com'].includes(url.hostname) ||
            !server?.listening ||
            Number(url.port) !== server.address().port
        ) {
            throw new Error('Test URL is not the active local HTTPS server');
        }

        return {
            url,
            hostname: url.hostname,
            addresses: [{ address: '127.0.0.1' }],
            dnsTimeMs: 0
        };
    };

    test('captures certificate expiry after a trusted TLS handshake', async () => {
        const result = await checkHttp(
            { url: baseUrl },
            {
                validateUrl: validateTestHttpsServer,
                tlsCa: certificate
            }
        );

        expect(result.statusCode).toBe(200);
        expect(result.body).toBe('secure');
        expect(result.tlsTimeMs).toEqual(expect.any(Number));

        expect(result.certificateExpiresAt).toBe(
            new Date(Date.parse(certificateInfo.validTo)).toISOString()
        );

        expect(result.certificateDaysRemaining).toBeGreaterThanOrEqual(0);
        expect(result.certificateDaysRemaining).toBeLessThanOrEqual(30);
    });

    test('rejects an untrusted self-signed certificate', async () => {
        await expect(
            checkHttp(
                { url: baseUrl },
                { validateUrl: validateTestHttpsServer }
            )
        ).rejects.toThrow();
    });

    test('rejects a hostname mismatch even when the certificate is trusted', async () => {
        const wrongHostnameUrl =
            `https://wrong.example.com:${server.address().port}`;

        await expect(
            checkHttp(
                { url: wrongHostnameUrl },
                {
                    validateUrl: validateTestHttpsServer,
                    tlsCa: certificate
                }
            )
        ).rejects.toThrow(/hostname|altname/i);
    });
});
