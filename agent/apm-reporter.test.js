const test = require('node:test');
const assert = require('node:assert/strict');

const {
    ApmReporter,
    isRetryable,
    parseRetryAfter
} = require('./apm-reporter');

// A reporter wired to a fake clock, fake timers and captured logs, so tests
// are deterministic and never wait on real time.
function createHarness(overrides = {}) {
    let time = 1_000_000;
    const timers = [];
    const logs = [];
    const sent = [];

    const reporter = new ApmReporter({
        now: () => time,
        setTimer: (fn, ms) => {
            const timer = { fn, ms, cleared: false, unref() {} };
            timers.push(timer);
            return timer;
        },
        clearTimer: (timer) => {
            timer.cleared = true;
        },
        logger: { warn: (message) => logs.push(message) },
        send: async (batch) => {
            sent.push(batch);
            return { accepted: batch.length, rejected: 0, errors: [] };
        },
        ...overrides
    });

    return {
        reporter,
        timers,
        logs,
        sent,
        advance: (ms) => {
            time += ms;
        },
        pendingTimers: () => timers.filter((timer) => !timer.cleared)
    };
}

function httpError(status, headers = {}) {
    const err = new Error(`Request failed with status code ${status}`);
    err.response = { status, headers };
    return err;
}

const trace = (n) => ({
    method: 'GET',
    route: `/r/${n}`,
    status_code: 200,
    duration_ms: n
});

test('requires a send function', () => {
    assert.throws(() => new ApmReporter({}), TypeError);
});

test('add() buffers and schedules a single flush at the interval', () => {
    const { reporter, timers } = createHarness({ flushIntervalMs: 5000 });

    reporter.add(trace(1));
    reporter.add(trace(2));
    reporter.add(trace(3));

    assert.equal(reporter.size, 3);
    assert.equal(timers.length, 1, 'only one timer for many adds');
    assert.equal(timers[0].ms, 5000);
});

test('the timer flushes everything buffered as one batch', async () => {
    const { reporter, timers, sent } = createHarness();

    reporter.add(trace(1));
    reporter.add(trace(2));

    timers[0].fn();
    await reporter.flushing;

    assert.deepEqual(sent, [[trace(1), trace(2)]]);
    assert.equal(reporter.size, 0);
    assert.equal(reporter.stats.sent, 2);
});

test('splits into maxBatchSize batches and caps requests per flush', async () => {
    const { reporter, sent, pendingTimers } = createHarness({
        maxBatchSize: 2,
        maxBatchesPerFlush: 2,
        maxBufferSize: 100
    });

    for (let i = 1; i <= 7; i++) reporter.add(trace(i));

    await reporter.flush();

    assert.equal(sent.length, 2, 'at most 2 requests per flush');
    assert.deepEqual(sent.map((batch) => batch.length), [2, 2]);
    assert.equal(reporter.size, 3, 'remainder stays buffered');
    assert.ok(pendingTimers().length >= 1, 'remainder is rescheduled');
});

test('force flush drains everything regardless of the per-flush cap', async () => {
    const { reporter, sent } = createHarness({
        maxBatchSize: 2,
        maxBatchesPerFlush: 1,
        maxBufferSize: 100
    });

    for (let i = 1; i <= 7; i++) reporter.add(trace(i));

    await reporter.flush({ force: true });

    assert.equal(sent.length, 4);
    assert.equal(reporter.size, 0);
});

test('drops the oldest traces when the buffer is full', () => {
    const { reporter } = createHarness({ maxBatchSize: 2, maxBufferSize: 3 });

    for (let i = 1; i <= 5; i++) reporter.add(trace(i));

    assert.equal(reporter.size, 3);
    assert.deepEqual(
        reporter.buffer.map((t) => t.duration_ms),
        [3, 4, 5]
    );
    assert.equal(reporter.stats.dropped, 2);
});

test('overflow warnings are rate limited to one per interval', () => {
    const { reporter, logs, advance } = createHarness({
        maxBatchSize: 1,
        maxBufferSize: 1,
        logIntervalMs: 60000
    });

    for (let i = 1; i <= 50; i++) reporter.add(trace(i));

    assert.equal(logs.length, 1, 'one line for 49 overflows');
    assert.match(logs[0], /^\[pulseiq-apm\] trace buffer is full/);

    advance(60001);
    reporter.add(trace(99));

    assert.equal(logs.length, 2);
    assert.match(logs[1], /\(\d+ similar message\(s\) suppressed\)/);
});

test('retries 5xx with exponential backoff and keeps the batch in order', async () => {
    let attempts = 0;
    const delivered = [];

    const { reporter, advance, logs } = createHarness({
        baseBackoffMs: 1000,
        send: async (batch) => {
            attempts++;

            if (attempts <= 2) throw httpError(503);

            delivered.push(batch);
            return { accepted: batch.length, rejected: 0 };
        }
    });

    reporter.add(trace(1));
    await reporter.flush();

    assert.equal(attempts, 1);
    assert.equal(reporter.size, 1, 'failed batch is kept');
    assert.equal(reporter.retryAt - reporter.now(), 1000, 'first backoff: 1s');
    assert.equal(logs.length, 1);

    // Inside the backoff window nothing is sent.
    reporter.add(trace(2));
    await reporter.flush();
    assert.equal(attempts, 1);

    advance(1000);
    await reporter.flush();

    assert.equal(attempts, 2);
    assert.equal(reporter.retryAt - reporter.now(), 2000, 'second backoff: 2s');

    advance(2000);
    await reporter.flush();

    assert.equal(attempts, 3);
    assert.deepEqual(
        delivered[0].map((t) => t.duration_ms),
        [1, 2],
        'oldest first, nothing lost'
    );
    assert.equal(reporter.failures, 0, 'success resets the failure count');
    assert.equal(reporter.retryAt, 0);
});

test('backoff is capped at maxBackoffMs', async () => {
    const { reporter, advance } = createHarness({
        baseBackoffMs: 1000,
        maxBackoffMs: 3000,
        send: async () => {
            throw httpError(500);
        }
    });

    reporter.add(trace(1));

    for (let i = 0; i < 6; i++) {
        advance(10000);
        await reporter.flush();
    }

    assert.equal(reporter.retryAt - reporter.now(), 3000);
});

test('honours Retry-After seconds on 429', async () => {
    const { reporter } = createHarness({
        maxBackoffMs: 120000,
        send: async () => {
            throw httpError(429, { 'retry-after': '30' });
        }
    });

    reporter.add(trace(1));
    await reporter.flush();

    assert.equal(reporter.retryAt - reporter.now(), 30000);
    assert.equal(reporter.size, 1);
});

test('Retry-After is capped at maxBackoffMs', async () => {
    const { reporter } = createHarness({
        maxBackoffMs: 10000,
        send: async () => {
            throw httpError(429, { 'retry-after': '3600' });
        }
    });

    reporter.add(trace(1));
    await reporter.flush();

    assert.equal(reporter.retryAt - reporter.now(), 10000);
});

test('the wake-up timer never fires before the backoff ends', async () => {
    const { reporter, timers } = createHarness({
        flushIntervalMs: 5000,
        maxBackoffMs: 120000,
        send: async () => {
            throw httpError(429, { 'retry-after': '45' });
        }
    });

    reporter.add(trace(1));
    timers[0].fn();
    await reporter.flushing;

    const next = timers[timers.length - 1];

    assert.equal(next.ms, 45000);
});

test('network errors (no response) are retried', async () => {
    const { reporter } = createHarness({
        send: async () => {
            throw new Error('connect ECONNREFUSED');
        }
    });

    reporter.add(trace(1));
    await reporter.flush();

    assert.equal(reporter.size, 1);
    assert.equal(reporter.failures, 1);
});

test('non-retryable 4xx drops the batch and carries on', async () => {
    let calls = 0;

    const { reporter, logs } = createHarness({
        maxBatchSize: 1,
        maxBatchesPerFlush: 5,
        maxBufferSize: 10,
        send: async () => {
            calls++;

            if (calls === 1) throw httpError(400);

            return { accepted: 1, rejected: 0 };
        }
    });

    reporter.add(trace(1));
    reporter.add(trace(2));

    await reporter.flush();

    assert.equal(calls, 2, 'second batch still sent');
    assert.equal(reporter.stats.dropped, 1);
    assert.equal(reporter.stats.sent, 1);
    assert.equal(reporter.size, 0);
    assert.match(logs[0], /dropped 1 trace\(s\): server answered 400/);
});

test('reports partial rejections from the server', async () => {
    const { reporter, logs } = createHarness({
        send: async () => ({
            accepted: 1,
            rejected: 2,
            errors: [{ index: 0, error: 'Invalid route' }]
        })
    });

    reporter.add(trace(1));
    reporter.add(trace(2));
    reporter.add(trace(3));

    await reporter.flush();

    assert.equal(reporter.stats.sent, 1);
    assert.equal(reporter.stats.rejected, 2);
    assert.match(logs[0], /rejected 2 of 3 trace\(s\) \(e\.g\. Invalid route\)/);
});

test('traces added while a request is in flight are not lost', async () => {
    let release;
    const delivered = [];

    const { reporter } = createHarness({
        send: (batch) => {
            delivered.push(batch.map((t) => t.duration_ms));

            // Only the first request is held open.
            if (delivered.length > 1) {
                return Promise.resolve({ accepted: batch.length, rejected: 0 });
            }

            return new Promise((resolve) => {
                release = () => resolve({ accepted: batch.length, rejected: 0 });
            });
        }
    });

    reporter.add(trace(1));

    const flushing = reporter.flush();

    // Arrives while the first request is still in flight.
    reporter.add(trace(2));
    assert.equal(reporter.flush(), flushing, 'concurrent flush reuses the promise');
    assert.deepEqual(reporter.buffer, [trace(2)], 'in-flight batch is not in the buffer');

    release();
    await flushing;

    assert.deepEqual(delivered, [[1], [2]], 'each trace delivered exactly once');
    assert.equal(reporter.size, 0);
});

test('shutdown force-flushes ignoring backoff, then stops accepting traces', async () => {
    let fail = true;
    const delivered = [];

    const { reporter, timers } = createHarness({
        send: async (batch) => {
            if (fail) throw httpError(503);

            delivered.push(batch);
            return { accepted: batch.length, rejected: 0 };
        }
    });

    reporter.add(trace(1));
    await reporter.flush();

    assert.ok(reporter.retryAt > reporter.now(), 'in backoff');

    fail = false;
    reporter.add(trace(2));
    await reporter.shutdown();

    assert.deepEqual(delivered[0].map((t) => t.duration_ms), [1, 2]);
    assert.ok(timers.every((timer) => timer.cleared || timer.fn), 'timers handled');

    reporter.add(trace(3));
    assert.equal(reporter.size, 0, 'closed reporter ignores new traces');

    await reporter.shutdown();
});

test('shutdown gives up after the timeout when the backend hangs', async () => {
    const { reporter } = createHarness({
        send: () => new Promise(() => {})
    });

    reporter.add(trace(1));

    const startedAt = Date.now();

    await reporter.shutdown(50);

    assert.ok(Date.now() - startedAt < 1000, 'returned promptly');
});

test('isRetryable', () => {
    assert.equal(isRetryable(null), true);
    assert.equal(isRetryable(408), true);
    assert.equal(isRetryable(429), true);
    assert.equal(isRetryable(500), true);
    assert.equal(isRetryable(503), true);
    assert.equal(isRetryable(400), false);
    assert.equal(isRetryable(401), false);
    assert.equal(isRetryable(404), false);
    assert.equal(isRetryable(413), false);
});

test('parseRetryAfter handles seconds, dates and junk', () => {
    const now = Date.parse('2026-11-26T10:00:00Z');

    assert.equal(parseRetryAfter('120', now), 120000);
    assert.equal(parseRetryAfter('0', now), 0);
    assert.equal(parseRetryAfter('Thu, 26 Nov 2026 10:00:30 GMT', now), 30000);
    assert.equal(parseRetryAfter('Thu, 26 Nov 2026 09:00:00 GMT', now), 0);
    assert.equal(parseRetryAfter('soon', now), null);
    assert.equal(parseRetryAfter(undefined, now), null);
    assert.equal(parseRetryAfter('', now), null);
});
