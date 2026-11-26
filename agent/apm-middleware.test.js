const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { EventEmitter } = require('node:events');

const createApmMiddleware = require('./apm-middleware');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function makeReq(overrides = {}) {
    return {
        method: 'GET',
        baseUrl: '/api',
        route: { path: '/orders/:id' },
        originalUrl: '/api/orders/5?x=1',
        ...overrides
    };
}

// Runs one request through the middleware. By default the response finishes
// normally; pass `abort: true` to simulate the client disconnecting first.
function runRequest(middleware, { req = makeReq(), statusCode = 200, abort = false } = {}) {
    const res = new EventEmitter();
    res.statusCode = statusCode;

    let nextCalled = false;
    middleware(req, res, () => { nextCalled = true; });

    if (abort) {
        res.emit('close');
    } else {
        res.emit('finish');
        res.emit('close'); // Node emits 'close' after 'finish' too
    }

    return nextCalled;
}

function makeTransport() {
    const calls = [];
    const transport = async (traces) => { calls.push(traces); };
    transport.calls = calls;
    return transport;
}

// flushIntervalMs is huge by default so only the behaviour under test flushes.
function build(options = {}) {
    return createApmMiddleware({
        backendUrl: 'http://pulseiq.test',
        apiKey: 'test-key',
        flushIntervalMs: 60 * 60 * 1000,
        ...options
    });
}

async function collect(options, requests) {
    const transport = makeTransport();
    const middleware = build({ transport, ...options });

    for (const request of requests) {
        runRequest(middleware, request);
    }

    await middleware.stop();

    return transport.calls.flat();
}

// Mirrors the backend's validateTraceInput rules: the backend rejects a whole
// batch when any one trace breaks them, so cleaned traces must always pass.
function serverAccepts(trace) {
    const noControl = (value) => !/[\x00-\x1F\x7F]/.test(value);
    const text = (value, max) =>
        typeof value === 'string' && value.trim().length > 0 && value.trim().length <= max && noControl(value);

    if (!text(trace.method, 10)) return false;
    if (!text(trace.route, 255)) return false;

    if (trace.status_code !== undefined && trace.status_code !== null) {
        if (!Number.isInteger(trace.status_code) || trace.status_code < 100 || trace.status_code > 599) return false;
    }

    if (trace.duration_ms !== undefined && trace.duration_ms !== null) {
        if (!Number.isInteger(trace.duration_ms) || trace.duration_ms < 0 || trace.duration_ms > 2147483647) return false;
    }

    if (typeof trace.timestamp !== 'string' || Number.isNaN(Date.parse(trace.timestamp))) return false;

    if (trace.service !== undefined && trace.service !== null) {
        if (typeof trace.service !== 'string' || trace.service.trim().length > 100 || !noControl(trace.service)) return false;
    }

    return true;
}

test('is a pass-through when backendUrl/apiKey are missing', async () => {
    const original = { url: process.env.PULSEIQ_BACKEND_URL, key: process.env.PULSEIQ_API_KEY };
    delete process.env.PULSEIQ_BACKEND_URL;
    delete process.env.PULSEIQ_API_KEY;

    const warn = console.warn;
    console.warn = () => {};

    try {
        const middleware = createApmMiddleware();

        assert.equal(runRequest(middleware), true);
        await middleware.flush();
        await middleware.stop();
        assert.deepEqual(middleware.stats(), { buffered: 0, dropped: 0 });
    } finally {
        console.warn = warn;
        if (original.url !== undefined) process.env.PULSEIQ_BACKEND_URL = original.url;
        if (original.key !== undefined) process.env.PULSEIQ_API_KEY = original.key;
    }
});

test('calls next() immediately and buffers one trace per finished request', async () => {
    const transport = makeTransport();
    const middleware = build({ transport });

    const nextCalled = runRequest(middleware, { statusCode: 201 });

    assert.equal(nextCalled, true);
    assert.deepEqual(middleware.stats(), { buffered: 1, dropped: 0 });
    assert.equal(transport.calls.length, 0);

    await middleware.stop();
});

test('sends all buffered traces in a single batch on flush', async () => {
    const transport = makeTransport();
    const middleware = build({ transport });

    runRequest(middleware, { statusCode: 200 });
    runRequest(middleware, { statusCode: 404 });
    runRequest(middleware, { statusCode: 500 });

    await middleware.flush();

    assert.equal(transport.calls.length, 1);
    assert.equal(transport.calls[0].length, 3);

    const [first] = transport.calls[0];

    assert.equal(first.method, 'GET');
    assert.equal(first.route, '/api/orders/:id');
    assert.equal(first.status_code, 200);
    assert.equal(Number.isInteger(first.duration_ms), true);
    assert.equal(Number.isNaN(Date.parse(first.timestamp)), false);
    assert.deepEqual(middleware.stats(), { buffered: 0, dropped: 0 });

    await middleware.stop();
});

test('flushes immediately once maxBatchSize traces are buffered', async () => {
    const transport = makeTransport();
    const middleware = build({ transport, maxBatchSize: 2 });

    runRequest(middleware);
    assert.equal(transport.calls.length, 0);

    runRequest(middleware);
    assert.equal(transport.calls.length, 1);
    assert.equal(transport.calls[0].length, 2);

    await middleware.stop();
});

test('flushes on the interval timer', async () => {
    const transport = makeTransport();
    const middleware = build({ transport, flushIntervalMs: 15 });

    runRequest(middleware);
    await sleep(120);

    assert.equal(transport.calls.length, 1);

    await middleware.stop();
});

test('keeps a batch after a transient failure and retries it', async () => {
    let attempts = 0;
    const delivered = [];
    const transport = async (traces) => {
        attempts += 1;
        if (attempts === 1) throw new Error('connect ECONNREFUSED');
        delivered.push(traces);
    };

    const originalError = console.error;
    console.error = () => {};

    try {
        const middleware = build({ transport });

        runRequest(middleware);
        runRequest(middleware);

        await middleware.flush();
        assert.deepEqual(middleware.stats(), { buffered: 2, dropped: 0 });

        await middleware.flush();
        assert.equal(delivered.length, 1);
        assert.equal(delivered[0].length, 2);
        assert.deepEqual(middleware.stats(), { buffered: 0, dropped: 0 });

        await middleware.stop();
    } finally {
        console.error = originalError;
    }
});

test('retries on 429 and 5xx responses', async () => {
    for (const status of [429, 503]) {
        let attempts = 0;
        const transport = async () => {
            attempts += 1;
            if (attempts === 1) {
                const err = new Error(`status ${status}`);
                err.response = { status };
                throw err;
            }
        };

        const originalError = console.error;
        console.error = () => {};

        try {
            const middleware = build({ transport });

            runRequest(middleware);
            await middleware.flush();
            assert.equal(middleware.stats().buffered, 1, `status ${status} should be kept`);

            await middleware.flush();
            assert.equal(middleware.stats().buffered, 0);

            await middleware.stop();
        } finally {
            console.error = originalError;
        }
    }
});

test('drops a batch the backend permanently rejects (4xx) instead of retrying forever', async () => {
    let attempts = 0;
    const transport = async () => {
        attempts += 1;
        const err = new Error('bad request');
        err.response = { status: 400 };
        throw err;
    };

    const originalError = console.error;
    console.error = () => {};

    try {
        const middleware = build({ transport });

        runRequest(middleware);
        runRequest(middleware);
        await middleware.flush();

        assert.equal(attempts, 1);
        assert.deepEqual(middleware.stats(), { buffered: 0, dropped: 2 });

        await middleware.stop();
    } finally {
        console.error = originalError;
    }
});

test('bounds memory: drops the oldest traces when the buffer is full', async () => {
    // A transport that never resolves keeps the first batch in flight, so
    // later traces pile up in the buffer.
    const transport = () => new Promise(() => {});
    const middleware = build({ transport, maxBatchSize: 2, maxBufferSize: 2 });

    for (let i = 0; i < 5; i += 1) {
        runRequest(middleware);
    }

    // 2 went in flight; of the 3 queued behind them only 2 fit.
    assert.deepEqual(middleware.stats(), { buffered: 2, dropped: 1 });

    // Not calling stop(): it would wait on the hung transport. The interval
    // timer is unref'd, so it cannot keep the test process alive.
});

test('a throwing transport never breaks the request', async () => {
    const transport = () => { throw new Error('sync boom'); };

    const originalError = console.error;
    console.error = () => {};

    try {
        const middleware = build({ transport, maxBatchSize: 1 });

        assert.doesNotThrow(() => runRequest(middleware));
        await sleep(10);
        assert.equal(middleware.stats().buffered, 1);

        await middleware.stop();
    } finally {
        console.error = originalError;
    }
});

test('stop() flushes what is left', async () => {
    const transport = makeTransport();
    const middleware = build({ transport });

    runRequest(middleware);
    runRequest(middleware);
    await middleware.stop();

    assert.equal(transport.calls.length, 1);
    assert.equal(transport.calls[0].length, 2);
});

// ---- Step 2: routes ------------------------------------------------------

test('prefixes the matched route pattern with the router mount path', async () => {
    const traces = await collect({}, [
        { req: makeReq({ baseUrl: '/api/v1', route: { path: '/widgets/:id' } }) },
        { req: makeReq({ baseUrl: '', route: { path: '/health' } }) }
    ]);

    assert.deepEqual(traces.map((t) => t.route), ['/api/v1/widgets/:id', '/health']);
});

test('collapses every unmatched request into one "<unmatched>" route', async () => {
    const urls = [
        '/nope',
        '/wp-admin/setup-config.php?step=1',
        '/.env',
        '/assets/app.3f9a1c.js',
        `/random/${Math.random()}?token=secret`
    ];

    const traces = await collect(
        {},
        urls.map((originalUrl) => ({
            req: makeReq({ route: undefined, originalUrl }),
            statusCode: 404
        }))
    );

    assert.equal(traces.length, urls.length);
    assert.deepEqual([...new Set(traces.map((t) => t.route))], ['UNMATCHED']);

    // The raw URL (and any token in its query string) is never reported.
    assert.equal(JSON.stringify(traces).includes('secret'), false);
    assert.equal(JSON.stringify(traces).includes('wp-admin'), false);
});

test('reports "<unmatched>" when the route pattern is a regex or an array', async () => {
    const traces = await collect({}, [
        { req: makeReq({ route: { path: /^\/legacy\/\d+$/ } }) },
        { req: makeReq({ route: { path: ['/a', '/b'] } }) }
    ]);

    assert.deepEqual(traces.map((t) => t.route), ['UNMATCHED', 'UNMATCHED']);
});

test('strips control characters from routes and caps them at 255 characters', async () => {
    const traces = await collect({}, [
        { req: makeReq({ baseUrl: '', route: { path: '/a\u0000b\nc' } }) },
        { req: makeReq({ baseUrl: '', route: { path: `/${'x'.repeat(400)}` } }) }
    ]);

    assert.equal(traces[0].route, '/abc');
    assert.equal(traces[1].route.length, 255);
});

// ---- Step 2: aborted requests --------------------------------------------

test('reports a request the client abandoned as status 499, once', async () => {
    const traces = await collect({}, [
        { statusCode: 200, abort: true }
    ]);

    assert.equal(traces.length, 1);
    assert.equal(traces[0].status_code, 499);
    assert.equal(traces[0].route, '/api/orders/:id');
});

test('a normal finish followed by close is reported once, with the real status', async () => {
    const traces = await collect({}, [
        { statusCode: 201 }
    ]);

    assert.equal(traces.length, 1);
    assert.equal(traces[0].status_code, 201);
});

// ---- Step 2: service name ------------------------------------------------

test('adds the service name to every trace, trimmed and capped at 100 characters', async () => {
    const trimmed = await collect({ serviceName: '  checkout-api  ' }, [{}]);
    assert.equal(trimmed[0].service, 'checkout-api');

    const capped = await collect({ serviceName: 'x'.repeat(150) }, [{}]);
    assert.equal(capped[0].service.length, 100);
});

test('reads the service name from PULSEIQ_SERVICE_NAME when no option is given', async () => {
    const original = process.env.PULSEIQ_SERVICE_NAME;
    process.env.PULSEIQ_SERVICE_NAME = 'billing-worker';

    try {
        const traces = await collect({}, [{}]);
        assert.equal(traces[0].service, 'billing-worker');
    } finally {
        if (original === undefined) delete process.env.PULSEIQ_SERVICE_NAME;
        else process.env.PULSEIQ_SERVICE_NAME = original;
    }
});

test('omits the service field when no service name is configured', async () => {
    const original = process.env.PULSEIQ_SERVICE_NAME;
    delete process.env.PULSEIQ_SERVICE_NAME;

    try {
        const traces = await collect({}, [{}]);
        assert.equal('service' in traces[0], false);
    } finally {
        if (original !== undefined) process.env.PULSEIQ_SERVICE_NAME = original;
    }
});

// ---- Step 2: every reported trace is acceptable to the backend -----------

test('a negative duration (clock stepped back) is clamped to 0', async () => {
    const realNow = Date.now;
    let calls = 0;
    Date.now = () => (calls++ === 0 ? 5000 : 4000);

    let traces;

    try {
        const transport = makeTransport();
        const middleware = build({ transport });
        runRequest(middleware);
        Date.now = realNow;
        await middleware.stop();
        traces = transport.calls.flat();
    } finally {
        Date.now = realNow;
    }

    assert.equal(traces[0].duration_ms, 0);
});

test('an out-of-range status code is reported as null instead of failing the batch', async () => {
    const traces = await collect({}, [
        { statusCode: 0 },
        { statusCode: 700 },
        { statusCode: null },
        { statusCode: NaN },
        { statusCode: '200' }
    ]);

    assert.deepEqual(traces.map((t) => t.status_code), [null, null, null, null, null]);
});

test('every trace built from hostile or odd input passes the backend rules', async () => {
    const hostile = [
        { req: makeReq({ method: 'get' }) },
        { req: makeReq({ method: 'a-very-long-custom-method-name' }) },
        { req: makeReq({ method: '' }) },
        { req: makeReq({ method: undefined }) },
        { req: makeReq({ method: 'GE\u0000T' }) },
        { req: makeReq({ route: undefined, originalUrl: `/${'y'.repeat(900)}` }) },
        { req: makeReq({ baseUrl: undefined, route: { path: '' } }) },
        { req: makeReq({ baseUrl: '\n', route: { path: '\t' } }) },
        { req: makeReq({ route: { path: `/${'z'.repeat(1000)}` } }) },
        { statusCode: -5 },
        { statusCode: 99999 },
        { abort: true },
        { abort: true, req: makeReq({ route: undefined }) }
    ];

    const traces = await collect({ serviceName: 'svc\u0007name' }, hostile);

    assert.equal(traces.length, hostile.length);

    traces.forEach((trace, index) => {
        assert.equal(serverAccepts(trace), true, `trace ${index} would be rejected: ${JSON.stringify(trace).slice(0, 200)}`);
    });
});

test('default transport POSTs the batch to /api/agent/traces/batch with the API key', async () => {
    const received = [];

    const server = http.createServer((req, res) => {
        let body = '';
        req.on('data', (chunk) => { body += chunk; });
        req.on('end', () => {
            received.push({
                method: req.method,
                url: req.url,
                apiKey: req.headers['x-api-key'],
                body: JSON.parse(body)
            });
            res.writeHead(201, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ accepted: 2 }));
        });
    });

    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

    try {
        const { port } = server.address();

        // Trailing slash on purpose: it must not produce "//api/...".
        const middleware = createApmMiddleware({
            backendUrl: `http://127.0.0.1:${port}/`,
            apiKey: 'real-key',
            serviceName: 'orders',
            flushIntervalMs: 60 * 60 * 1000
        });

        runRequest(middleware);
        runRequest(middleware);
        await middleware.stop();

        assert.equal(received.length, 1);
        assert.equal(received[0].method, 'POST');
        assert.equal(received[0].url, '/api/agent/traces/batch');
        assert.equal(received[0].apiKey, 'real-key');
        assert.equal(received[0].body.traces.length, 2);
        assert.equal(received[0].body.traces[0].route, '/api/orders/:id');
        assert.equal(received[0].body.traces[0].service, 'orders');
    } finally {
        await new Promise((resolve) => server.close(resolve));
    }
});