const si = require('systeminformation');
const pool = require('../config/db');
const { evaluateAlerts } = require('../services/alert.service');
const { broadcastMetrics } = require('../services/websocket.service');
const { processMetricRollups } = require('../services/metricRollup.service');

async function collectAndStoreMetrics() {

    try {

        const cpu = await si.currentLoad();
        const memory = await si.mem();
        const disks = await si.fsSize();
        const network = await si.networkStats();

        const metric = {
            cpu_usage: parseFloat(cpu.currentLoad.toFixed(2)),
            memory_usage: parseFloat(((memory.used / memory.total) * 100).toFixed(2)),
            disk_usage: disks[0] ? parseFloat(disks[0].use.toFixed(2)) : 0,
            network_in: network[0] ? parseFloat((network[0].rx_sec / 1024).toFixed(2)) : 0,
            network_out: network[0] ? parseFloat((network[0].tx_sec / 1024).toFixed(2)) : 0
        };

        const result = await pool.query(
            `
            INSERT INTO metrics (
                cpu_usage,
                memory_usage,
                disk_usage,
                network_in,
                network_out
            )
            VALUES ($1, $2, $3, $4, $5)
            RETURNING *
            `,
            [
                metric.cpu_usage,
                metric.memory_usage,
                metric.disk_usage,
                metric.network_in,
                metric.network_out
            ]
        );

        const savedMetric = result.rows[0];

        await evaluateAlerts(savedMetric);
        await processMetricRollups(savedMetric);

        // Broadcast to WebSocket clients
        broadcastMetrics(savedMetric);

        console.log('Metrics collected:', savedMetric);

    } catch (err) {
        console.error('Metric collection failed:', err.message);
    }

}

// Run immediately
collectAndStoreMetrics();

// Run every 5 sec
setInterval(collectAndStoreMetrics, 5000);