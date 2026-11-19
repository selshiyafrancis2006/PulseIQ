const test = require('node:test');
const assert = require('node:assert/strict');

const { MetricDeliveryQueue } = require('./metric-delivery-queue');

function createLogger() {
    return {
        warn: () => {},
        error: () => {}
    };
}

test('delivers a queued sample successfully', async () => {
    const sent = [];

    const queue = new MetricDeliveryQueue({
        send: async (payload) => sent.push(payload),
        logger: createLogger()
    });

    const payload = { sample_id: 'sample-1' };

    queue.enqueue(payload);
    await queue.waitForIdle();

    assert.deepEqual(sent, [payload]);
    assert.equal(queue.size, 0);
});

test('retries transient failures with exponential backoff', async () => {
    const delays = [];
    let attempts = 0;

    const queue = new MetricDeliveryQueue({
        send: async () => {
            attempts++;

            if (attempts < 3) {
                throw new Error('Network unavailable');
            }
        },
        sleep: async (ms) => delays.push(ms),
        logger: createLogger()
    });

    queue.enqueue({ sample_id: 'sample-2' });
    await queue.waitForIdle();

    assert.equal(attempts, 3);
    assert.deepEqual(delays, [1000, 2000]);
    assert.equal(queue.size, 0);
});

test('retries HTTP 429 and 5xx responses', async () => {
    let attempts = 0;

    const queue = new MetricDeliveryQueue({
        send: async () => {
            attempts++;

            if (attempts === 1) {
                const error = new Error('Rate limited');
                error.response = { status: 429 };
                throw error;
            }

            if (attempts === 2) {
                const error = new Error('Server error');
                error.response = { status: 503 };
                throw error;
            }
        },
        sleep: async () => {},
        logger: createLogger()
    });

    queue.enqueue({ sample_id: 'sample-3' });
    await queue.waitForIdle();

    assert.equal(attempts, 3);
    assert.equal(queue.size, 0);
});

test('does not retry permanent HTTP 401 failures', async () => {
    let attempts = 0;

    const queue = new MetricDeliveryQueue({
        send: async () => {
            attempts++;
            const error = new Error('Unauthorized');
            error.response = { status: 401 };
            throw error;
        },
        sleep: async () => {},
        logger: createLogger()
    });

    queue.enqueue({ sample_id: 'sample-4' });
    await queue.waitForIdle();

    assert.equal(attempts, 1);
    assert.equal(queue.size, 0);
});

test('stops after the configured maximum number of attempts', async () => {
    let attempts = 0;

    const queue = new MetricDeliveryQueue({
        send: async () => {
            attempts++;
            throw new Error('Network unavailable');
        },
        sleep: async () => {},
        maxAttempts: 5,
        logger: createLogger()
    });

    queue.enqueue({ sample_id: 'sample-5' });
    await queue.waitForIdle();

    assert.equal(attempts, 5);
    assert.equal(queue.size, 0);
});

test('preserves the in-flight sample and drops the oldest waiting sample when full', async () => {
    let releaseFirst;
    let markStarted;

    const firstStarted = new Promise((resolve) => {
        markStarted = resolve;
    });

    const sent = [];

    const queue = new MetricDeliveryQueue({
        maxSize: 3,
        send: async (payload) => {
            sent.push(payload.sample_id);

            if (payload.sample_id === 'first') {
                markStarted();
                await new Promise((resolve) => {
                    releaseFirst = resolve;
                });
            }
        },
        logger: createLogger()
    });

    queue.enqueue({ sample_id: 'first' });
    await firstStarted;

    queue.enqueue({ sample_id: 'second' });
    queue.enqueue({ sample_id: 'third' });
    queue.enqueue({ sample_id: 'fourth' });

    assert.equal(queue.size, 3);

    releaseFirst();
    await queue.waitForIdle();

    assert.deepEqual(sent, ['first', 'third', 'fourth']);
    assert.equal(queue.size, 0);
});

test('counts every sample that is given up on', async () => {
    let call = 0;

    const queue = new MetricDeliveryQueue({
        maxAttempts: 2,
        send: async () => {
            call++;

            if (call === 1) {
                const error = new Error('Bad request');
                error.response = { status: 400 };
                throw error;
            }

            throw new Error('Network unavailable');
        },
        sleep: async () => {},
        logger: createLogger()
    });

    assert.equal(queue.droppedCount, 0);

    queue.enqueue({ sample_id: 'permanent' });
    queue.enqueue({ sample_id: 'exhausted' });
    await queue.waitForIdle();

    assert.equal(queue.droppedCount, 2);
    assert.equal(queue.size, 0);
});

test('counts samples dropped because the queue is full', async () => {
    let releaseFirst;
    let markStarted;

    const firstStarted = new Promise((resolve) => {
        markStarted = resolve;
    });

    const queue = new MetricDeliveryQueue({
        maxSize: 2,
        send: async (payload) => {
            if (payload.sample_id === 'first') {
                markStarted();
                await new Promise((resolve) => {
                    releaseFirst = resolve;
                });
            }
        },
        logger: createLogger()
    });

    queue.enqueue({ sample_id: 'first' });
    await firstStarted;

    queue.enqueue({ sample_id: 'second' });
    queue.enqueue({ sample_id: 'third' });
    queue.enqueue({ sample_id: 'fourth' });

    assert.equal(queue.droppedCount, 2);

    releaseFirst();
    await queue.waitForIdle();
});

test('flush resolves with 0 once everything is delivered', async () => {
    const sent = [];

    const queue = new MetricDeliveryQueue({
        send: async (payload) => sent.push(payload.sample_id),
        logger: createLogger()
    });

    queue.enqueue({ sample_id: 'a' });
    queue.enqueue({ sample_id: 'b' });

    const remaining = await queue.flush(1000);

    assert.equal(remaining, 0);
    assert.deepEqual(sent, ['a', 'b']);
});

test('flush gives up after the timeout and reports what is left', async () => {
    const queue = new MetricDeliveryQueue({
        send: () => new Promise(() => {}),
        logger: createLogger()
    });

    queue.enqueue({ sample_id: 'stuck-1' });
    queue.enqueue({ sample_id: 'stuck-2' });

    const remaining = await queue.flush(50);

    assert.equal(remaining, 2);
});

function createMemoryStore(initial = []) {
    const store = {
        saves: [],
        load: () => initial,
        save: (items) => store.saves.push(items.map((item) => item.sample_id))
    };

    return store;
}

const recent = (id) => ({
    sample_id: id,
    collected_at: new Date().toISOString()
});

test('restores saved samples and delivers them in order', async () => {
    const sent = [];
    const store = createMemoryStore([recent('old-1'), recent('old-2')]);

    const queue = new MetricDeliveryQueue({
        store,
        send: async (payload) => sent.push(payload.sample_id),
        logger: createLogger()
    });

    assert.equal(queue.restoredCount, 2);
    assert.equal(queue.size, 2);

    queue.enqueue(recent('new'));
    await queue.waitForIdle();

    assert.deepEqual(sent, ['old-1', 'old-2', 'new']);
});

test('saves the queue after every enqueue and every delivery', async () => {
    const store = createMemoryStore();

    const queue = new MetricDeliveryQueue({
        store,
        send: async () => {},
        logger: createLogger()
    });

    queue.enqueue(recent('a'));
    await queue.waitForIdle();

    assert.deepEqual(store.saves, [['a'], []]);
});

test('keeps an unsent sample saved when delivery never finishes', async () => {
    const store = createMemoryStore();

    const queue = new MetricDeliveryQueue({
        store,
        send: () => new Promise(() => {}),
        logger: createLogger()
    });

    queue.enqueue(recent('stuck'));
    await queue.flush(30);

    assert.deepEqual(store.saves[store.saves.length - 1], ['stuck']);
});

test('discards saved samples older than the maximum age', () => {
    const now = Date.parse('2026-11-19T10:00:00.000Z');
    const store = createMemoryStore([
        { sample_id: 'stale', collected_at: '2026-11-19T06:00:00.000Z' },
        { sample_id: 'fresh', collected_at: '2026-11-19T09:30:00.000Z' },
        { sample_id: 'bad-date', collected_at: 'not a date' }
    ]);

    const queue = new MetricDeliveryQueue({
        store,
        maxAgeMs: 2 * 60 * 60 * 1000,
        now: () => now,
        send: async () => {},
        logger: createLogger()
    });

    assert.deepEqual(queue.items.map((item) => item.sample_id), ['fresh']);
    assert.deepEqual(store.saves, [['fresh']]);
});

test('keeps only the newest saved samples when more than the limit were saved', () => {
    const store = createMemoryStore([
        recent('1'),
        recent('2'),
        recent('3'),
        recent('4')
    ]);

    const queue = new MetricDeliveryQueue({
        store,
        maxSize: 2,
        send: async () => {},
        logger: createLogger()
    });

    assert.deepEqual(queue.items.map((item) => item.sample_id), ['3', '4']);
});