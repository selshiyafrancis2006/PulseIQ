require('dotenv').config();

const si = require('systeminformation');
const axios = require('axios');

const BACKEND_URL = process.env.BACKEND_URL;
const API_KEY = process.env.API_KEY;
const INTERVAL_MS = Number(process.env.INTERVAL_MS) || 5000;

async function collectAndSend() {

    try {

        const cpuLoad = await si.currentLoad();
        const mem = await si.mem();
        const disk = await si.fsSize();
        const network = await si.networkStats();

        const cpu_usage = Number(cpuLoad.currentLoad.toFixed(2));

        const memory_usage = Number(
            ((mem.used / mem.total) * 100).toFixed(2)
        );

        const disk_usage = disk.length > 0
            ? Number(disk[0].use.toFixed(2))
            : 0;

        const network_in = network.length > 0
            ? Number((network[0].rx_sec / 1024).toFixed(2))
            : 0;

        const network_out = network.length > 0
            ? Number((network[0].tx_sec / 1024).toFixed(2))
            : 0;

        const payload = {
            cpu_usage,
            memory_usage,
            disk_usage,
            network_in,
            network_out
        };

        const response = await axios.post(
            BACKEND_URL,
            payload,
            {
                headers: {
                    'X-API-Key': API_KEY,
                    'Content-Type': 'application/json'
                }
            }
        );

        console.log(
            `[${new Date().toISOString()}] Sent metrics — host_id: ${response.data.host_id}`
        );

    } catch (err) {

        console.error(
            `[${new Date().toISOString()}] Failed to send metrics:`,
            err.response?.data || err.message
        );

    }

}

console.log(`PulseIQ Agent starting — sending to ${BACKEND_URL} every ${INTERVAL_MS}ms`);

collectAndSend();

setInterval(collectAndSend, INTERVAL_MS);