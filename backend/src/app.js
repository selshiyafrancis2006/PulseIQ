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
const metricsRoutes =
    require('./routes/metrics.routes');

const alertsRoutes =
    require('./routes/alerts.routes');

const authRoutes =
    require('./routes/auth.routes');

const app = express();

const server = http.createServer(app);

const wss = new WebSocketServer({ server });

// Initialize websocket service
setWSS(wss);

// Middleware
app.use(cors());

app.use(express.json());

// Routes
app.use('/api', metricsRoutes);

app.use('/api', alertsRoutes);

app.use('/api/auth', authRoutes);

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
require('./jobs/metric.job');

module.exports = {
    app,
    server
};