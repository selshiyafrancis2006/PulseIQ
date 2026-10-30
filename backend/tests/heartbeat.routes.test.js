jest.mock('../src/config/db', () => ({
    query: jest.fn()
}));

const express = require('express');
const request = require('supertest');
const crypto = require('crypto');
const db = require('../src/config/db');
const heartbeatRoutes = require('../src/routes/heartbeat.routes');

const app = express();
app.use('/api/heartbeat', heartbeatRoutes);

const monitorId = 42;
const token = 'a'.repeat(64);
const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

beforeEach(() => {
    jest.clearAllMocks();
});

test('accepts a valid heartbeat token and records check-in', async () => {
    db.query
        .mockResolvedValueOnce({ rows: [{ token_hash: tokenHash }] })
        .mockResolvedValueOnce({ rowCount: 1, rows: [] });

    const response = await request(app)
        .post(`/api/heartbeat/${monitorId}`)
        .set('x-heartbeat-token', token);

    expect(response.status).toBe(202);
    expect(response.body).toMatchObject({
        message: 'Heartbeat received',
        monitor_id: monitorId
    });
    expect(db.query).toHaveBeenCalledTimes(2);
    expect(db.query.mock.calls[1][0]).toMatch(/UPDATE heartbeat_monitor_secrets/i);
});

test('rejects a missing heartbeat token', async () => {
    const response = await request(app).post(`/api/heartbeat/${monitorId}`);

    expect(response.status).toBe(401);
    expect(db.query).not.toHaveBeenCalled();
});

test('rejects a token that does not match the stored hash', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ token_hash: 'b'.repeat(64) }] });

    const response = await request(app)
        .post(`/api/heartbeat/${monitorId}`)
        .set('x-heartbeat-token', token);

    expect(response.status).toBe(401);
    expect(db.query).toHaveBeenCalledTimes(1);
});

test('returns 404 when no active heartbeat monitor exists', async () => {
    db.query.mockResolvedValueOnce({ rows: [] });

    const response = await request(app)
        .post(`/api/heartbeat/${monitorId}`)
        .set('x-heartbeat-token', token);

    expect(response.status).toBe(404);
    expect(db.query).toHaveBeenCalledTimes(1);
});

test('rejects an invalid monitor ID before querying the database', async () => {
    const response = await request(app)
        .post('/api/heartbeat/0')
        .set('x-heartbeat-token', token);

    expect(response.status).toBe(400);
    expect(db.query).not.toHaveBeenCalled();
});

test('returns 500 if the database query fails', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    db.query.mockRejectedValueOnce(new Error('database unavailable'));

    try {
        const response = await request(app)
            .post(`/api/heartbeat/${monitorId}`)
            .set('x-heartbeat-token', token);

        expect(response.status).toBe(500);
    } finally {
        errorSpy.mockRestore();
    }
});
