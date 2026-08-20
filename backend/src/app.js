const express = require('express');

const cors = require('cors');

const http = require('http');

const { WebSocketServer } = require('ws');

const pool = require('./config/db');

const si = require('systeminformation');

const {
    setWSS
} = require('./services/websocket.service');

// Routes
const monitorRoutes = 
    require('./routes/monitor.routes');

const metricsRoutes =
    require('./routes/metrics.routes');

const alertsRoutes =
    require('./routes/alerts.routes');

const authRoutes =
    require('./routes/auth.routes');

const processesRoutes =
    require('./routes/processes.routes');

const serviceHealthRoutes =
    require('./routes/serviceHealth.routes');

const loggerMiddleware = 
    require("./middleware/logger.middleware");

const authenticate =
    require("./middleware/auth.middleware");

const logsRoutes = require("./routes/logs.routes");

const app = express();

const server = http.createServer(app);

const wss = new WebSocketServer({ server });

// Initialize websocket service
setWSS(wss);

// Middleware
app.use(cors());

app.use(express.json());

app.use(loggerMiddleware);

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

// Health Route
app.get('/', (req, res) => {

    res.json({
        message:
            'PulseIQ backend is running!'
    });

});

// System Info Route
app.get(
    '/api/system-info',
    async (req, res) => {

        try {

            const os =
                await si.osInfo();

            const cpu =
                await si.cpu();

            const mem =
                await si.mem();

            const time =
                await si.time();

            res.json({

                hostname:
                    os.hostname,

                os:
                    `${os.distro} ${os.release}`,

                cpu:
                    cpu.brand,

                ram:
                    `${(
                        mem.total /
                        1024 /
                        1024 /
                        1024
                    ).toFixed(1)} GB`,

                uptime:
                    `${Math.floor(
                        time.uptime / 3600
                    )}h ${
                        Math.floor(
                            (
                                time.uptime %
                                3600
                            ) / 60
                        )
                    }m`

            });

        } catch (err) {

            console.error(err);

            res.status(500).json({
                error: err.message
            });

        }

    }
);

// WebSocket Connection
wss.on('connection', (ws) => {

    console.log(
        'Client connected via WebSocket'
    );

    const interval =
        setInterval(async () => {

            try {

                const result =
                    await pool.query(`
                    SELECT *
                    FROM metrics
                    ORDER BY timestamp DESC
                    LIMIT 10
                `);

                ws.send(
                    JSON.stringify(
                        result.rows
                    )
                );

            } catch (err) {

                console.error(
                    'WebSocket error:',
                    err
                );

            }

        }, 5000);

    ws.on('close', () => {

        console.log(
            'Client disconnected'
        );

        clearInterval(interval);

    });

});

// Start metrics job
(async () => {
    await import('./jobs/metric.job.js');
    await import('./jobs/uptime.job.js');
})();

module.exports = {
    app,
    server
};