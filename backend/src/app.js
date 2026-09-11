const express = require('express');
const cors = require('cors');
const http = require('http');
const { WebSocketServer } = require('ws');
const pool = require('./config/db');
const si = require('systeminformation');
const { URL } = require('url');
const jwt = require('jsonwebtoken');
const JWT_SECRET = require('./config/jwt');

const {
    setWSS
} = require('./services/websocket.service');

// Routes
const monitorRoutes = require('./routes/monitor.routes');
const metricsRoutes = require('./routes/metrics.routes');
const alertsRoutes = require('./routes/alerts.routes');
const authRoutes = require('./routes/auth.routes');
const processesRoutes = require('./routes/processes.routes');
const serviceHealthRoutes = require('./routes/serviceHealth.routes');
const loggerMiddleware = require("./middleware/logger.middleware");
const authenticate = require("./middleware/auth.middleware");
const agentRoutes = require('./routes/agent.routes');
const logsRoutes = require("./routes/logs.routes");
const hostsRoutes = require('./routes/hosts.routes');
const apmRoutes = require('./routes/apm.routes');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// Initialize websocket service
setWSS(wss);

// Middleware
app.use(cors());
app.use(express.json());
app.use('/api/agent', agentRoutes);
app.use(loggerMiddleware);

// System Info Route
app.get('/api/system-info', async (req, res) => {
    try {
        const os = await si.osInfo();
        const cpu = await si.cpu();
        const mem = await si.mem();
        const time = await si.time();

        res.json({
            hostname: os.hostname,
            os: `${os.distro} ${os.release}`,
            cpu: cpu.brand,
            ram: `${(mem.total / 1024 / 1024 / 1024).toFixed(1)} GB`,
            uptime: `${Math.floor(time.uptime / 3600)}h ${Math.floor((time.uptime % 3600) / 60)}m`
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
});

// Routes
// Public — no auth required
app.use('/api/auth', authRoutes);

// Protected — requires a valid JWT
app.use('/api/monitors', authenticate, monitorRoutes);
app.use('/api', authenticate, metricsRoutes);
app.use('/api', authenticate, alertsRoutes);
app.use('/api', authenticate, processesRoutes);
app.use('/api/service-health', authenticate, serviceHealthRoutes);
app.use("/api/logs", authenticate, logsRoutes);
app.use('/api/hosts', authenticate, hostsRoutes);
app.use('/api/apm', authenticate, apmRoutes);

// Health Route
app.get('/', (req, res) => {
    res.json({ message: 'PulseIQ backend is running!' });
});

// WebSocket Connection
// Metrics are pushed to clients via broadcastMetrics() from metric.job.js
// and agent.routes.js — no per-client polling here.
wss.on('connection', async (ws, req) => {

    const { searchParams } = new URL(req.url, `http://${req.headers.host}`);
    const token = searchParams.get('token');
    const hostId = searchParams.get('host_id');

    if (!token) {
        ws.close(4401, 'Missing auth token');
        return;
    }

    let decoded;

    try {
        decoded = jwt.verify(token, JWT_SECRET);
    } catch (err) {
        ws.close(4401, 'Invalid or expired token');
        return;
    }

    if (!hostId || Number.isNaN(Number(hostId))) {
        ws.close(4400, 'Missing or invalid host_id');
        return;
    }

    try {

        const ownership = await pool.query(
            'SELECT id FROM hosts WHERE id = $1 AND user_id = $2',
            [Number(hostId), decoded.id]
        );

        if (ownership.rows.length === 0) {
            ws.close(4403, 'Host not found');
            return;
        }

    } catch (err) {
        console.error('WebSocket ownership check failed:', err);
        ws.close(1011, 'Internal error');
        return;
    }

    ws.hostId = Number(hostId);

    console.log(`Client connected via WebSocket (host_id: ${ws.hostId})`);

    ws.on('close', () => {
        console.log(`Client disconnected (host_id: ${ws.hostId})`);
    });
});

// Start metrics job
(async () => {
    await import('./jobs/uptime.job.js');
    await import('./jobs/rollup.job.js');
})();


module.exports = {
    app,
    server
};