const { listUsableDisks, listUsableNetworkStats } = require('./metric-selection');
const { toRateKBps } = require('./metric-rates');

const MAX_DISKS = 20;
const MAX_INTERFACES = 20;

function safeTag(value) {
    if (value === null || value === undefined) return undefined;

    const text = String(value).trim();

    return text ? text.slice(0, 128) : undefined;
}

function addMetric(metrics, metricName, value, unit, tags = {}) {
    const number = Number(value);

    if (!Number.isFinite(number) || number < 0) return;

    metrics.push({
        metric_name: metricName,
        value: number,
        unit,
        tags
    });
}

function buildSystemCustomMetrics({
    disks = [],
    networkStats = [],
    loadAverage = null
} = {}) {
    const metrics = [];

    // Collect separate measurements for each usable disk.
    for (const disk of listUsableDisks(disks).slice(0, MAX_DISKS)) {
        const tags = {};

        const mount = safeTag(disk.mount);
        const filesystem = safeTag(disk.fs);
        const device = safeTag(disk.rw);

        if (mount) tags.mount = mount;
        if (filesystem) tags.filesystem = filesystem;
        if (device) tags.device = device;

        addMetric(metrics, 'disk_usage_percent', disk.use, '%', tags);
        addMetric(metrics, 'disk_total_bytes', disk.size, 'bytes', tags);
        addMetric(metrics, 'disk_used_bytes', disk.used, 'bytes', tags);
    }

    // Collect separate receive/transmit rates for each usable interface.
    for (const network of listUsableNetworkStats(networkStats).slice(0, MAX_INTERFACES)) {
        const iface = safeTag(network.iface);

        if (!iface) continue;

        const tags = { iface };

        addMetric(
            metrics,
            'network_receive_kbps',
            toRateKBps(network.rx_sec),
            'KB/s',
            tags
        );

        addMetric(
            metrics,
            'network_transmit_kbps',
            toRateKBps(network.tx_sec),
            'KB/s',
            tags
        );
    }

    // Load averages are unavailable on Windows.
    if (Array.isArray(loadAverage)) {
        const names = ['loadavg_1m', 'loadavg_5m', 'loadavg_15m'];

        names.forEach((name, index) => {
            addMetric(metrics, name, loadAverage[index], 'load', {});
        });
    }

    return metrics;
}

module.exports = { buildSystemCustomMetrics };
