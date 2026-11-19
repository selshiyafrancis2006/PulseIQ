const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createFileStore } = require('./metric-queue-store');

function tempDir() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'pulseiq-queue-'));
}

function createLogger() {
    const warnings = [];

    return {
        warnings,
        warn: (message) => warnings.push(message),
        error: () => {}
    };
}

const sample = (id) => ({
    sample_id: id,
    collected_at: '2026-11-19T05:00:00.000Z',
    cpu_usage: 10
});

test('saves and loads queued samples', () => {
    const file = path.join(tempDir(), 'queue.json');
    const store = createFileStore(file, { logger: createLogger() });

    store.save([sample('a'), sample('b')]);

    assert.deepEqual(
        store.load().map((item) => item.sample_id),
        ['a', 'b']
    );
});

test('loads an empty queue when the file does not exist', () => {
    const file = path.join(tempDir(), 'missing.json');
    const store = createFileStore(file, { logger: createLogger() });

    assert.deepEqual(store.load(), []);
});

test('moves an unreadable file aside and starts empty', () => {
    const dir = tempDir();
    const file = path.join(dir, 'queue.json');
    const logger = createLogger();
    const store = createFileStore(file, { logger });

    fs.writeFileSync(file, '{ not json');

    assert.deepEqual(store.load(), []);
    assert.equal(fs.existsSync(file), false);
    assert.equal(fs.existsSync(`${file}.corrupt`), true);
    assert.equal(logger.warnings.length, 1);
});

test('ignores entries that are not valid samples', () => {
    const file = path.join(tempDir(), 'queue.json');
    const store = createFileStore(file, { logger: createLogger() });

    fs.writeFileSync(
        file,
        JSON.stringify([sample('ok'), null, 'text', { sample_id: 5 }, {}])
    );

    assert.deepEqual(
        store.load().map((item) => item.sample_id),
        ['ok']
    );
});

test('leaves no temporary file behind after saving', () => {
    const dir = tempDir();
    const file = path.join(dir, 'queue.json');
    const store = createFileStore(file, { logger: createLogger() });

    store.save([sample('a')]);
    store.save([]);

    assert.deepEqual(fs.readdirSync(dir), ['queue.json']);
    assert.deepEqual(store.load(), []);
});

test('a failing save does not throw and warns only once', () => {
    const dir = tempDir();
    const blocker = path.join(dir, 'blocker');
    fs.writeFileSync(blocker, 'a file, not a folder');

    const logger = createLogger();
    const store = createFileStore(path.join(blocker, 'queue.json'), { logger });

    assert.doesNotThrow(() => {
        store.save([sample('a')]);
        store.save([sample('b')]);
    });

    assert.equal(logger.warnings.length, 1);
});