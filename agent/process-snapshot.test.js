const test = require('node:test');
const assert = require('node:assert/strict');

const { summarizeProcesses, createProcessReporter } = require('./process-snapshot');

const proc = (pid, name, cpu, memRssKb) => ({ pid, name, cpu, memRss: memRssKb });

test('takes the top processes by cpu and by memory without duplicates', () => {
    const list = [
        proc(1, 'cpu-hog', 90, 1024),
        proc(2, 'mem-hog', 1, 2048 * 1024),
        proc(3, 'both', 50, 1024 * 1024),
        proc(4, 'idle', 0, 10)
    ];

    const result = summarizeProcesses(list, { perSort: 2 });

    assert.deepEqual(
        result.map((p) => p.pid).sort(),
        [1, 2, 3]
    );
});

test('converts memory from KB to MB and rounds cpu', () => {
    const [entry] = summarizeProcesses([proc(7, ' node ', 12.3456, 51200)]);

    assert.deepEqual(entry, { pid: 7, name: 'node', cpu: 12.35, memory_mb: 50 });
});

test('skips entries without a pid or a name and treats bad numbers as 0', () => {
    const result = summarizeProcesses([
        null,
        { name: 'no-pid', cpu: 1 },
        { pid: 5, name: '  ', cpu: 1 },
        { pid: 6, name: 'bad-numbers', cpu: 'x', memRss: -5 }
    ]);

    assert.deepEqual(result, [{ pid: 6, name: 'bad-numbers', cpu: 0, memory_mb: 0 }]);
});

test('returns an empty list when the input is not an array', () => {
    assert.deepEqual(summarizeProcesses(undefined), []);
    assert.deepEqual(summarizeProcesses({}), []);
});

test('sends a snapshot with the collection time', async () => {
    const sent = [];
    const reporter = createProcessReporter({
        listProcesses: async () => [proc(1, 'a', 1, 1024)],
        send: async (payload) => sent.push(payload),
        intervalMs: 1000,
        now: () => new Date('2026-11-22T10:00:00Z')
    });

    assert.equal(await reporter.tick(), true);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].collected_at, '2026-11-22T10:00:00.000Z');
    assert.equal(sent[0].processes[0].name, 'a');
});

test('warns once while sending keeps failing and again after a recovery', async () => {
    const warnings = [];
    let fail = true;
    const reporter = createProcessReporter({
        listProcesses: async () => [],
        send: async () => {
            if (fail) throw new Error('backend down');
        },
        intervalMs: 30000,
        logger: { warn: (message) => warnings.push(message) }
    });

    assert.equal(await reporter.tick(), false);
    assert.equal(await reporter.tick(), false);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /backend down/);

    fail = false;
    assert.equal(await reporter.tick(), true);

    fail = true;
    await reporter.tick();
    assert.equal(warnings.length, 2);
});

test('does not start a second run while one is still in progress', async () => {
    let release;
    let calls = 0;
    const reporter = createProcessReporter({
        listProcesses: () => {
            calls += 1;

            return new Promise((resolve) => {
                release = () => resolve([]);
            });
        },
        send: async () => {},
        intervalMs: 1000
    });

    const first = reporter.tick();

    assert.equal(await reporter.tick(), false);
    assert.equal(calls, 1);

    release();
    await first;
});

test('a failing process list never throws out of tick', async () => {
    const reporter = createProcessReporter({
        listProcesses: async () => {
            throw new Error('permission denied');
        },
        send: async () => {},
        intervalMs: 1000,
        logger: { warn() {} }
    });

    assert.equal(await reporter.tick(), false);
});