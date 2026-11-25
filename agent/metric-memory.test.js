const test = require('node:test');
const assert = require('node:assert/strict');

const { getMemoryUsagePercent } = require('./metric-memory');

test('uses total minus available on Linux', () => {
    assert.equal(
        getMemoryUsagePercent({
            total: 1000,
            used: 900,
            available: 300
        }, 'linux'),
        70
    );
});

test('preserves used divided by total on Windows', () => {
    assert.equal(
        getMemoryUsagePercent({
            total: 1000,
            used: 850,
            available: 300
        }, 'win32'),
        85
    );
});

test('rounds percentages to two decimal places', () => {
    assert.equal(
        getMemoryUsagePercent({
            total: 1000,
            available: 333.33
        }, 'linux'),
        66.67
    );
});

test('clamps percentages between 0 and 100', () => {
    assert.equal(getMemoryUsagePercent({
        total: 1000,
        available: -100
    }, 'linux'), 100);

    assert.equal(getMemoryUsagePercent({
        total: 1000,
        available: 1200
    }, 'linux'), 0);
});

test('returns zero for invalid memory readings', () => {
    assert.equal(getMemoryUsagePercent(null, 'linux'), 0);
    assert.equal(getMemoryUsagePercent({ total: 0, available: 0 }, 'linux'), 0);
    assert.equal(getMemoryUsagePercent({ total: 1000 }, 'linux'), 0);
    assert.equal(getMemoryUsagePercent({ total: 1000, used: NaN }, 'win32'), 0);
});
