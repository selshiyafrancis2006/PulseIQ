const axios = require('axios');
const http = require('node:http');
const https = require('node:https');
const { validatePublicHttpUrl } = require('./urlSecurity.service');

const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_TIMEOUT_MS = 30_000;
const MAX_RESPONSE_BYTES = 1_000_000;
const MAX_REDIRECTS = 3;

function createPinnedAgent(url, validatedAddress, timings) {
    const lookup = (hostname, options, callback) => {
        if (typeof options === 'function') {
            callback = options;
            options = {};
        }

        // Never resolve the hostname again during this connection.
        if (hostname.toLowerCase() !== url.hostname.toLowerCase()) {
            callback(new Error('Unexpected hostname during connection'));
            return;
        }

        const result = {
            address: validatedAddress,
            family: require('node:net').isIP(validatedAddress)
        };

        if (options && options.all) {
            callback(null, [result]);
        } else {
            callback(null, result.address, result.family);
        }
    };

    const Agent = url.protocol === 'https:' ? https.Agent : http.Agent;

    const agent = new Agent({
        keepAlive: false,
        lookup
    });

    const originalAddRequest = agent.addRequest;

    agent.addRequest = function (request, options) {
        const requestStartedAt = process.hrtime.bigint();

        request.once('socket', (socket) => {
            const socketAssignedAt = process.hrtime.bigint();
            let connectedAt = null;

            socket.once('connect', () => {
                connectedAt = process.hrtime.bigint();

                timings.connectTimeMs =
                    Number(connectedAt - socketAssignedAt) / 1e6;
            });

            if (url.protocol === 'https:') {
                socket.once('secureConnect', () => {
                    const tlsCompletedAt = process.hrtime.bigint();

                    timings.tlsTimeMs = connectedAt === null
                        ? null
                        : Number(tlsCompletedAt - connectedAt) / 1e6;
                });
            }

            request.once('response', (response) => {
                timings.ttfbTimeMs =
                    Number(
                        process.hrtime.bigint() - requestStartedAt
                    ) / 1e6;

                const downloadStartedAt = process.hrtime.bigint();

                response.once('end', () => {
                    timings.downloadTimeMs =
                        Number(
                            process.hrtime.bigint() - downloadStartedAt
                        ) / 1e6;
                });
            });
        });

        return originalAddRequest.call(this, request, options);
    };

    return agent;
}

async function checkHttp(monitor, options = {}) {
    const validateUrl =
        options.validateUrl || validatePublicHttpUrl;

    const startedAt = Date.now();
    const timeoutMs = Number(monitor.timeout_ms) || DEFAULT_TIMEOUT_MS;

    if (
        !Number.isInteger(timeoutMs) ||
        timeoutMs < 1 ||
        timeoutMs > MAX_TIMEOUT_MS
    ) {
        throw new Error(
            `timeout_ms must be between 1 and ${MAX_TIMEOUT_MS}`
        );
    }

    let currentUrl;

    try {
        currentUrl = new URL(monitor.url);
    } catch {
        throw new Error('Invalid monitor URL');
    }

    // DNS can legitimately take 0 ms for an IP-literal URL.
    // Other timings remain null until actually measured.
    const totalTimings = {
        dnsTimeMs: 0,
        connectTimeMs: null,
        tlsTimeMs: null,
        ttfbTimeMs: null,
        downloadTimeMs: null
    };

    for (let redirectCount = 0; ; redirectCount += 1) {
        // Resolve and validate every destination, including redirects.
        const validated = await validateUrl(currentUrl.href);
        const validatedAddress = validated.addresses[0].address;

        const timings = {
            dnsTimeMs: validated.dnsTimeMs ?? 0,
            connectTimeMs: null,
            tlsTimeMs: null,
            ttfbTimeMs: null,
            downloadTimeMs: null
        };

        totalTimings.dnsTimeMs += timings.dnsTimeMs;

        const agent = createPinnedAgent(
            currentUrl,
            validatedAddress,
            timings
        );

        let response;

        try {
            response = await axios.request({
                url: currentUrl.href,
                method: monitor.method || 'GET',
                headers: monitor.headers || {},
                data: monitor.body ?? undefined,
                timeout: timeoutMs,
                maxRedirects: 0,
                maxContentLength: MAX_RESPONSE_BYTES,
                maxBodyLength: MAX_RESPONSE_BYTES,
                responseType: 'text',
                validateStatus: () => true,
                httpAgent: currentUrl.protocol === 'http:'
                    ? agent
                    : undefined,
                httpsAgent: currentUrl.protocol === 'https:'
                    ? agent
                    : undefined,
                proxy: false,
                transitional: {
                    clarifyTimeoutError: true
                }
            });
        } finally {
            agent.destroy();

            for (const key of [
                'connectTimeMs',
                'tlsTimeMs',
                'ttfbTimeMs',
                'downloadTimeMs'
            ]) {
                if (timings[key] !== null) {
                    totalTimings[key] =
                        (totalTimings[key] ?? 0) + timings[key];
                }
            }
        }

        const statusCode = response.status;
        const isRedirect = [301, 302, 303, 307, 308].includes(statusCode);
        const location = response.headers.location;

        if (isRedirect && location) {
            if (redirectCount >= MAX_REDIRECTS) {
                throw new Error(
                    `Too many redirects (maximum ${MAX_REDIRECTS})`
                );
            }

            let nextUrl;

            try {
                nextUrl = new URL(location, currentUrl);
            } catch {
                throw new Error('Invalid redirect URL');
            }

            if (
                !['http:', 'https:'].includes(nextUrl.protocol) ||
                nextUrl.username ||
                nextUrl.password
            ) {
                throw new Error(
                    'Redirect target uses a disallowed URL'
                );
            }

            currentUrl = nextUrl;
            continue;
        }

        return {
            statusCode,
            responseTimeMs: Date.now() - startedAt,
            body: typeof response.data === 'string'
                ? response.data
                : JSON.stringify(response.data ?? ''),
            headers: response.headers,
            finalUrl: currentUrl.href,
            ...totalTimings
        };
    }
}

module.exports = { checkHttp };