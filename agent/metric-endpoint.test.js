const test = require('node:test');
const assert = require('node:assert/strict');

const { getMetricsEndpoint } = require('./metric-endpoint');

const config = {
    metricsUrl: 'https://pulseiq.example.com/api/agent/metrics',
    customMetricsUrl: 'https://pulseiq.example.com/api/agent/custom-metrics'
};

test('routes fixed metric payloads to the original endpoint', () => {
    const payload = {
        cpu_usage: 25,
        memory_usage: 60
    };

    assert.equal(getMetricsEndpoint(payload, config), config.metricsUrl);
});

test('routes custom metric payloads to the custom endpoint', () => {
    const payload = {
        sample_id: 'sample-1',
        metrics: [
            { metric_name: 'disk_used_bytes', value: 100 }
        ]
    };

    assert.equal(
        getMetricsEndpoint(payload, config),
        config.customMetricsUrl
    );
});
