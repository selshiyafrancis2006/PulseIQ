const { Registry, Gauge } = require('@prometheus-io/client');
const pool = require('../config/db');
const {
    OFFLINE_THRESHOLD_SECONDS,
    statusSql
} = require('../utils/hostStatus');

const LABEL_NAMES = ['host_id', 'host_name'];

const createGauge = (registry, name, help) => {
    return new Gauge({
        name,
        help,
        labelNames: LABEL_NAMES,
        registers: [registry]
    });
};

const setIfValid = (
    gauge,
    labels,
    value,
    { multiplier = 1, min = 0, max = Infinity } = {}
) => {
    if (value === null || value === undefined) {
        return;
    }

    const numericValue = Number(value);

    if (
        !Number.isFinite(numericValue) ||
        numericValue < min ||
        numericValue > max
    ) {
        return;
    }

    gauge.set(labels, numericValue * multiplier);
};

const getPrometheusMetrics = async () => {
    const registry = new Registry();

    const result = await pool.query(
        `SELECT
            h.id,
            h.name,
            h.last_seen_at,
            ${statusSql('h', 1)} AS status,
            latest.cpu_usage,
            latest.memory_usage,
            latest.disk_usage,
            latest.network_in,
            latest.network_out
         FROM hosts h
         LEFT JOIN LATERAL (
            SELECT
                cpu_usage,
                memory_usage,
                disk_usage,
                network_in,
                network_out
            FROM metrics
            WHERE host_id = h.id
            ORDER BY COALESCE(collected_at, timestamp) DESC
            LIMIT 1
         ) latest ON TRUE
         ORDER BY h.id ASC`,
        [OFFLINE_THRESHOLD_SECONDS]
    );

    const hostUp = createGauge(
        registry,
        'pulseiq_host_up',
        'Whether the host has a recent heartbeat (1 = online, 0 = pending or offline).'
    );

    const hostLastSeen = createGauge(
        registry,
        'pulseiq_host_last_seen_timestamp_seconds',
        'Unix timestamp of the host last heartbeat.'
    );

    const cpuUsage = createGauge(
        registry,
        'pulseiq_cpu_usage_percent',
        'Latest host CPU usage percentage.'
    );

    const memoryUsage = createGauge(
        registry,
        'pulseiq_memory_usage_percent',
        'Latest host memory usage percentage.'
    );

    const diskUsage = createGauge(
        registry,
        'pulseiq_disk_usage_percent',
        'Latest host disk usage percentage.'
    );

    const networkReceive = createGauge(
        registry,
        'pulseiq_network_receive_bytes_per_second',
        'Latest host network receive rate in bytes per second.'
    );

    const networkTransmit = createGauge(
        registry,
        'pulseiq_network_transmit_bytes_per_second',
        'Latest host network transmit rate in bytes per second.'
    );

    for (const host of result.rows) {
        const labels = {
            host_id: String(host.id),
            host_name: host.name
        };

        hostUp.set(labels, host.status === 'online' ? 1 : 0);

        if (host.last_seen_at !== null) {
            const lastSeenSeconds =
                new Date(host.last_seen_at).getTime() / 1000;

            if (Number.isFinite(lastSeenSeconds)) {
                hostLastSeen.set(labels, lastSeenSeconds);
            }
        }

        setIfValid(cpuUsage, labels, host.cpu_usage, { max: 100 });
        setIfValid(memoryUsage, labels, host.memory_usage, { max: 100 });
        setIfValid(diskUsage, labels, host.disk_usage, { max: 100 });

        // The agent stores network rates in KB/s.
        setIfValid(networkReceive, labels, host.network_in, { multiplier: 1024 });
        setIfValid(networkTransmit, labels, host.network_out, { multiplier: 1024 });
    }

    return {
        contentType: registry.contentType,
        body: await registry.metrics()
    };
};

module.exports = { getPrometheusMetrics };
