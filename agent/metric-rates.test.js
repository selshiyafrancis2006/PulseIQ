const test = require('node:test');
const assert = require('node:assert/strict');

const { toRateKBps } = require('./metric-rates');

test('converts bytes per second to KB/s with two decimals', () => {
    assert.equal(toRateKBps(2048), 2);
    assert.equal(toRateKBps(1536), 1.5);
    assert.equal(toRateKBps(1), 0);
});

test('turns a missing rate into 0', () => {
    assert.equal(toRateKBps(null), 0);
    assert.equal(toRateKBps(undefined), 0);
});

test('turns a negative rate into 0', () => {
    assert.equal(toRateKBps(-500), 0);
});

test('turns a non-finite or non-numeric rate into 0', () => {
    assert.equal(toRateKBps(NaN), 0);
    assert.equal(toRateKBps(Infinity), 0);
    assert.equal(toRateKBps('abc'), 0);
});