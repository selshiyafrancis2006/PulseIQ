const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const net = require('node:net');

const {
    startMonitorRunner,
    runCheck,
    evaluateHttp,
    classifyError
} = require('./monitor-runner');

async function waitFor(condition, attempts = 100) {
    for (let i = 0; i < attempts && !condition(); i += 1) {
        await new Promise((resolve) => setTimeout(resolve, 20));
    }
}

function listen(server) {
    return new Promise((resolve) =>
        server.listen(0, '127.0.0.1', () => resolve(server.address().port))
    );
}

test('evaluateHttp: default rule accepts 200-399 only', () => {
    assert.equal(evaluateHttp({}, { statusCode: 200, responseTimeMs: 5, body: '' }).status, 'UP');
    assert.equal(evaluateHttp({}, { statusCode: 399, responseTimeMs: 5, body: '' }).status, 'UP');

    const down = evaluateHttp({}, { statusCode: 500, responseTimeMs: 5, body: '' });
    assert.equal(down.status, 'DOWN');
    assert.equal(down.error_type, 'BAD_STATUS');
    assert.match(down.error_message, /HTTP 500/);
});

test('evaluateHttp: configured status codes replace the default rule', () => {
    const monitor = { expected_status_codes: [204] };
    assert.equal(evaluateHttp(monitor, { statusCode: 204, responseTimeMs: 1, body: '' }).status, 'UP');
    assert.equal(evaluateHttp(monitor, { statusCode: 200, responseTimeMs: 1, body: '' }).status, 'DOWN');
});

test('evaluateHttp: keyword match is case-insensitive', () => {
    const monitor = { expected_keyword: 'Healthy' };
    assert.equal(evaluateHttp(monitor, { statusCode: 200, responseTimeMs: 1, body: 'all HEALTHY' }).status, 'UP');

    const down = evaluateHttp(monitor, { statusCode: 200, responseTimeMs: 1, body: 'error page' });
    assert.equal(down.status, 'DOWN');
    assert.equal(down.error_type, 'UNEXPECTED_BODY');
});

test('evaluateHttp: slow response is DOWN when a limit is set', () => {
    const monitor = { max_response_time_ms: 100 };
    assert.equal(evaluateHttp(monitor, { statusCode: 200, responseTimeMs: 100, body: '' }).status, 'UP');

    const down = evaluateHttp(monitor, { statusCode: 200, responseTimeMs: 101, body: '' });
    assert.equal(down.error_type, 'SLOW_RESPONSE');
});

test('classifyError uses the server error_type names', () => {
    assert.equal(classifyError({ code: 'ECONNREFUSED' }).errorType, 'CONNECTION_REFUSED');
    assert.equal(classifyError({ code: 'ENOTFOUND' }).errorType, 'DNS');
    assert.equal(classifyError({ code: 'ETIMEDOUT' }).errorType, 'TIMEOUT');
    assert.equal(classifyError({ message: 'Maximum number of redirects exceeded' }).errorType, 'TOO_MANY_REDIRECTS');
    assert.equal(classifyError(new Error('boom')).errorType, 'NETWORK');
});

test('runCheck HTTP: UP against a live server, DOWN on 500', async () => {
    const server = http.createServer((req, res) => {
        if (req.url === '/bad') {
            res.statusCode = 500;
            return res.end('nope');
        }
        res.end('hello world');
    });
    const port = await listen(server);

    try {
        const up = await runCheck({
            monitor_type: 'HTTP',
            url: `http://127.0.0.1:${port}/`,
            expected_keyword: 'hello'
        });
        assert.equal(up.status, 'UP');
        assert.equal(up.status_code, 200);
        assert.ok(up.response_time_ms >= 0);

        const down = await runCheck({
            monitor_type: 'HTTP',
            url: `http://127.0.0.1:${port}/bad`
        });
        assert.equal(down.status, 'DOWN');
        assert.equal(down.error_type, 'BAD_STATUS');
    } finally {
        server.close();
    }
});

test('runCheck HTTP: sends the configured method and headers', async () => {
    let seen;
    const server = http.createServer((req, res) => {
        seen = { method: req.method, header: req.headers['x-test'] };
        res.end('ok');
    });
    const port = await listen(server);

    try {
        await runCheck({
            monitor_type: 'HTTP',
            url: `http://127.0.0.1:${port}/`,
            method: 'HEAD',
            headers: { 'X-Test': 'yes' }
        });
        assert.deepEqual(seen, { method: 'HEAD', header: 'yes' });
    } finally {
        server.close();
    }
});

test('runCheck HTTP: connection refused is DOWN with a typed error', async () => {
    const probe = net.createServer();
    const port = await listen(probe);
    await new Promise((resolve) => probe.close(resolve)); // port is now closed

    const result = await runCheck({
        monitor_type: 'HTTP',
        url: `http://127.0.0.1:${port}/`
    });

    assert.equal(result.status, 'DOWN');
    assert.equal(result.error_type, 'CONNECTION_REFUSED');
    assert.equal(result.response_time_ms, null);
});

test('runCheck TCP: UP when the port accepts, DOWN when closed', async () => {
    const server = net.createServer((socket) => socket.end());
    const port = await listen(server);

    try {
        const up = await runCheck({
            monitor_type: 'TCP',
            tcp_host: '127.0.0.1',
            tcp_port: port
        });
        assert.equal(up.status, 'UP');
    } finally {
        await new Promise((resolve) => server.close(resolve));
    }

    const down = await runCheck({
        monitor_type: 'TCP',
        tcp_host: '127.0.0.1',
        tcp_port: port
    });
    assert.equal(down.status, 'DOWN');
    assert.equal(down.error_type, 'CONNECTION_REFUSED');
});

test('runCheck DNS: an unresolvable name is DOWN, bad config never throws', async () => {
    const down = await runCheck({
        monitor_type: 'DNS',
        dns_hostname: 'does-not-exist.invalid',
        dns_record_type: 'A'
    });
    assert.equal(down.status, 'DOWN');

    const bad = await runCheck({ monitor_type: 'DNS', dns_record_type: 'BOGUS' });
    assert.equal(bad.status, 'DOWN');
});

test('runner: polls monitors, runs them, and reports results with the API key', async () => {
    const target = http.createServer((req, res) => res.end('ok'));
    const targetPort = await listen(target);

    const reported = [];
    let pollKey;

    const backend = http.createServer((req, res) => {
        let raw = '';
        req.on('data', (chunk) => (raw += chunk));
        req.on('end', () => {
            res.setHeader('Content-Type', 'application/json');

            if (req.method === 'GET' && req.url === '/api/agent/monitors') {
                pollKey = req.headers['x-api-key'];
                return res.end(JSON.stringify({
                    monitors: [{
                        id: 7,
                        name: 'local',
                        monitor_type: 'HTTP',
                        url: `http://127.0.0.1:${targetPort}/`,
                        interval_seconds: 30
                    }]
                }));
            }

            if (req.method === 'POST' && req.url === '/api/agent/monitor-results') {
                reported.push(JSON.parse(raw));
                res.statusCode = 201;
                return res.end('{}');
            }

            res.statusCode = 404;
            res.end('{}');
        });
    });
    const backendPort = await listen(backend);

    const quiet = { error() {}, log() {} };
    const runner = startMonitorRunner({
        baseUrl: `http://127.0.0.1:${backendPort}`,
        apiKey: 'test-key',
        logger: quiet,
        options: { pollEveryMs: 60_000 }
    });

    try {
        // The runner polls once on its own at start-up.
        await waitFor(() => runner._tracked.size === 1);
        assert.equal(runner._tracked.size, 1);

        // Skip the start-up jitter instead of waiting for it.
        runner._tracked.get(7).nextRunAt = 0;
        runner._tick();

        for (let i = 0; i < 50 && reported.length === 0; i += 1) {
            await new Promise((resolve) => setTimeout(resolve, 50));
        }

        assert.equal(pollKey, 'test-key');
        assert.equal(reported.length, 1);
        assert.equal(reported[0].monitor_id, 7);
        assert.equal(reported[0].status, 'UP');

        // Not due again for a full interval.
        runner._tick();
        await new Promise((resolve) => setTimeout(resolve, 200));
        assert.equal(reported.length, 1);
    } finally {
        runner.stop();
        target.close();
        backend.close();
    }
});

test('runner: drops monitors the server no longer assigns', async () => {
    let monitors = [{ id: 1, monitor_type: 'TCP', tcp_host: '127.0.0.1', tcp_port: 1, interval_seconds: 30 }];

    const backend = http.createServer((req, res) => {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ monitors }));
    });
    const port = await listen(backend);

    const runner = startMonitorRunner({
        baseUrl: `http://127.0.0.1:${port}`,
        apiKey: 'k',
        logger: { error() {}, log() {} },
        options: { pollEveryMs: 60_000 }
    });

    try {
        await waitFor(() => runner._tracked.size === 1);
        assert.equal(runner._tracked.size, 1);

        monitors = [];
        await runner._poll();
        assert.equal(runner._tracked.size, 0);
    } finally {
        runner.stop();
        backend.close();
    }
});