const si = require('systeminformation');
const pool = require('./db');
const checkAnomaly = require('./anomaly');

const collectMetrics = async () => {
    try {
        const cpu = await si.currentLoad();
        const mem = await si.mem();
        const disk = await si.fsSize();
        const network = await si.networkStats();
        
        const cpuUsage = cpu.currentLoad;
        const memoryUsage = (mem.used / mem.total) * 100;
        const diskUsage = disk[0].use;
        const networkIn = network[0].rx_sec / 1024;
        const networkOut = network[0].tx_sec / 1024;

        await pool.query(
            `INSERT INTO metrics (cpu_usage, memory_usage, disk_usage, network_in, network_out)
             VALUES ($1, $2, $3, $4, $5)`,
            [cpuUsage, memoryUsage, diskUsage, networkIn, networkOut]
        );

        await checkAnomaly('cpu_usage', cpuUsage);
        await checkAnomaly('memory_usage', memoryUsage);
        await checkAnomaly('disk_usage', diskUsage);
        await checkAnomaly('network_in', networkIn);
        await checkAnomaly('network_out', networkOut);

        console.log(`Metrics Saved - CPU: ${cpuUsage.toFixed(2)}%`);
    }
    catch (err) {
        console.error('Error collecting metrics:', err);
    }
};

setInterval(collectMetrics, 5000);

module.exports = collectMetrics;