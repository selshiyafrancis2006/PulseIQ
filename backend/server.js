const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
dotenv.config();

const http = require('http');
const { WebSocketServer } = require('ws');

const pool = require('./db');
const routes = require('./routes');
const auth = require('./auth');
require('./collector');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());
app.use('/api', routes);
app.use('/api/auth', auth);

app.get('/', (req, res) => {
    res.json({ message: 'PulseIQ backend is running!' });
});

wss.on('connection', (ws) => {
    console.log('Client connected via WebSocket');

    const interval = setInterval(async () => {
        try {
            const result = await pool.query(
                'SELECT * FROM metrics ORDER BY timestamp DESC LIMIT 1'
            );
            ws.send(JSON.stringify(result.rows[0]));
        } catch (err) {
            console.error('WebSocket error:', err);
        }
    }, 5000);

    ws.on('close', () => {
        console.log('Client disconnected');
        clearInterval(interval);
    });
});

server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});