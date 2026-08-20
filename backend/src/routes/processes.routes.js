const express = require('express');
const si = require('systeminformation');

const router = express.Router();

// 🔥 memory stores (Datadog-style agent state)
const cpuHistory = new Map();
const statusHistory = new Map();

router.get('/processes', async (req, res) => {
    console.log("Processes API called");

    try {
        const processes = await si.processes();

        const list = Array.isArray(processes.list)
            ? processes.list
            : [];

        const topProcesses = list
            .filter(p => p && p.name)
            .sort((a, b) => (b.memRss || 0) - (a.memRss || 0))
            .slice(0, 20)
            .map(process => {

                const pid = process.pid;

                const rawCpu = Number(process.cpu) || 0;
                const memMB = Math.round((process.memRss || 0) / 1024);

                // =========================
                // 🔥 CPU SMOOTHING
                // =========================
                const prevCpu = cpuHistory.get(pid) ?? rawCpu;
                const smoothCpu = prevCpu * 0.7 + rawCpu * 0.3;
                cpuHistory.set(pid, smoothCpu);

                // =========================
                // 🔥 STATUS WITH HYSTERESIS
                // =========================
                const prevStatus = statusHistory.get(pid) || "Sleeping";

                let newStatus;

                if (smoothCpu > 2) {
                    newStatus = "Running";
                } else if (smoothCpu > 0.3) {
                    newStatus = "Idle";
                } else {
                    newStatus = "Sleeping";
                }

                // hysteresis (prevents flicker)
                let finalStatus = prevStatus;

                if (prevStatus === "Running" && smoothCpu < 1.5) {
                    finalStatus = "Idle";
                } else if (prevStatus === "Idle" && smoothCpu < 0.1) {
                    finalStatus = "Sleeping";
                } else if (smoothCpu > 2) {
                    finalStatus = "Running";
                }

                statusHistory.set(pid, finalStatus);

                return {
                    pid: pid || 0,
                    name: process.name || 'unknown',

                    cpu: Number(smoothCpu.toFixed(2)),
                    memory: memMB,

                    status: finalStatus
                };
            });

        res.json(topProcesses);

    } catch (err) {
        console.error("PROCESS API ERROR:", err);

        res.status(500).json({
            error: err.message || 'Internal Server Error'
        });
    }
});

module.exports = router;