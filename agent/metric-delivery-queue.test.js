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
