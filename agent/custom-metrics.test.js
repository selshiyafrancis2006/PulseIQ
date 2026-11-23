const test = require('node:test');
const assert = require('node:assert/strict');

const { buildSystemCustomMetrics } = require('./custom-metrics');

test('collects separate metrics for every usable disk', () => {
    const metrics = buildSystemCustomMetrics({
        disks: [
            { mount: '/', fs: 'ext4', size: 1000, used: 400, use: 40 },
            { mount: '/data', fs: 'xfs', size: 5000, used: 2500, use: 50 }
        ]
    });

    assert.equal(metrics.length, 6);

    const root = metrics.filter((metric) => metric.tags.mount === '/');
    const data = metrics.filter((metric) => metric.tags.mount === '/data');

    assert.equal(root.length, 3);
    assert.equal(data.length, 3);
    assert.equal(root.find((metric) => metric.metric_name === 'disk_used_bytes').value, 400);
});

test('collects receive and transmit rates for every non-loopback interface', () => {
    const metrics = buildSystemCustomMetrics({
        networkStats: [
            { iface: 'lo', rx_sec: 1024, tx_sec: 2048 },
            { iface: 'eth0', rx_sec: 2048, tx_sec: 4096 },
            { iface: 'wlan0', rx_sec: 1024, tx_sec: 3072 }
        ]
    });

    assert.equal(metrics.length, 4);
    assert.deepEqual(
        metrics.map((metric) => [metric.metric_name, metric.tags.iface, metric.value]),
        [
            ['network_receive_kbps', 'eth0', 2],
            ['network_transmit_kbps', 'eth0', 4],
            ['network_receive_kbps', 'wlan0', 1],
            ['network_transmit_kbps', 'wlan0', 3]
        ]
    );
});

test('includes three load average metrics when supported', () => {
    const metrics = buildSystemCustomMetrics({
        loadAverage: [1.25, 0.75, 0.5]
    });

    assert.deepEqual(
        metrics.map((metric) => [metric.metric_name, metric.value]),
        [
            ['loadavg_1m', 1.25],
            ['loadavg_5m', 0.75],
            ['loadavg_15m', 0.5]
        ]
    );
});

test('omits load average metrics when unavailable', () => {
    assert.deepEqual(
        buildSystemCustomMetrics({ loadAverage: null }),
        []
    );
});

test('ignores invalid measurements and malformed dimensions', () => {
    const metrics = buildSystemCustomMetrics({
        disks: [
            { mount: '/bad', size: 100, used: NaN, use: NaN },
            { mount: '/good', size: 100, used: 50, use: 50 }
        ],
        networkStats: [
            { iface: 'eth0', rx_sec: null, tx_sec: -1 },
            { iface: '', rx_sec: 1024, tx_sec: 1024 }
        ],
        loadAverage: [1, NaN, -1]
    });

    assert.deepEqual(
        metrics.map((metric) => metric.metric_name),
        [
            'disk_usage_percent',
            'disk_total_bytes',
            'disk_used_bytes',
            'network_receive_kbps',
            'network_transmit_kbps',
            'loadavg_1m'
        ]
    );

    assert.equal(metrics[3].value, 0);
    assert.equal(metrics[4].value, 0);
});

test('caps disk and interface collection at safe limits', () => {
    const disks = Array.from({ length: 25 }, (_, index) => ({
        mount: `/disk${index}`,
        size: 1000,
        used: 500,
        use: 50
    }));

    const networkStats = Array.from({ length: 25 }, (_, index) => ({
        iface: `eth${index}`,
        rx_sec: 1024,
        tx_sec: 1024
    }));

    const metrics = buildSystemCustomMetrics({ disks, networkStats });

    assert.equal(metrics.length, 100);
});
