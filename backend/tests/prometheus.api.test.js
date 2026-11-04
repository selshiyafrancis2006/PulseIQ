const {
    app,
    pool,
    request,
    resetDb,
    createUser,
    authHeader
} = require('./helpers');

let user;
let onlineHostId;
let pendingHostId;
let originalPrometheusToken;

async function registerHost(token, name) {
    const response = await request(app)
        .post('/api/hosts/register')
        .set(authHeader(token))
        .send({ name });

    expect(response.status).toBe(201);
    return response.body.id;
}

beforeAll(async () => {
    originalPrometheusToken = process.env.PROMETHEUS_METRICS_TOKEN;

    await resetDb();

    user = await createUser();
    onlineHostId = await registerHost(user.token, 'prometheus-online-host');
    pendingHostId = await registerHost(user.token, 'prometheus-pending-host');

    await pool.query(
        'UPDATE hosts SET last_seen_at = NOW() WHERE id = $1',
        [onlineHostId]
    );
});

afterAll(async () => {
    if (originalPrometheusToken === undefined) {
        delete process.env.PROMETHEUS_METRICS_TOKEN;
    } else {
        process.env.PROMETHEUS_METRICS_TOKEN = originalPrometheusToken;
    }

    await pool.end();
});

beforeEach(async () => {
    await pool.query('TRUNCATE metrics RESTART IDENTITY');
});

describe('GET /metrics - Prometheus exporter', () => {
    test('fails closed when the exporter token is not configured', async () => {
        delete process.env.PROMETHEUS_METRICS_TOKEN;

        const response = await request(app).get('/metrics');

        expect(response.status).toBe(503);
        expect(response.body.error).toMatch(/not configured/i);
    });

    test('rejects a missing or invalid bearer token', async () => {
        process.env.PROMETHEUS_METRICS_TOKEN = 'test-prometheus-secret';

        const missing = await request(app).get('/metrics');

        const invalid = await request(app)
            .get('/metrics')
            .set('Authorization', 'Bearer incorrect-secret');

        expect(missing.status).toBe(401);
        expect(invalid.status).toBe(401);
    });

    test('exports host status and latest metrics with correct units', async () => {
        process.env.PROMETHEUS_METRICS_TOKEN = 'test-prometheus-secret';

        await pool.query(
            `INSERT INTO metrics
                (host_id, timestamp, collected_at,
                 cpu_usage, memory_usage, disk_usage, network_in, network_out)
             VALUES
                ($1, NOW() - INTERVAL '2 minutes', NOW() - INTERVAL '2 minutes',
                 20, 30, 40, 1, 2),
                ($1, NOW() - INTERVAL '1 minute', NOW() - INTERVAL '1 minute',
                 65, 55, 45, 2.5, 3.5)`,
            [onlineHostId]
        );

        const response = await request(app)
            .get('/metrics')
            .set('Authorization', 'Bearer test-prometheus-secret');

        expect(response.status).toBe(200);
        expect(response.headers['content-type']).toMatch(/text\/plain/);

        const body = response.text;

        expect(body).toContain('# TYPE pulseiq_host_up gauge');
        expect(body).toContain(
            `pulseiq_host_up{host_id="${onlineHostId}",host_name="prometheus-online-host"} 1`
        );
        expect(body).toContain(
            `pulseiq_host_up{host_id="${pendingHostId}",host_name="prometheus-pending-host"} 0`
        );

        expect(body).toContain(
            `pulseiq_cpu_usage_percent{host_id="${onlineHostId}",host_name="prometheus-online-host"} 65`
        );
        expect(body).toContain(
            `pulseiq_memory_usage_percent{host_id="${onlineHostId}",host_name="prometheus-online-host"} 55`
        );
        expect(body).toContain(
            `pulseiq_disk_usage_percent{host_id="${onlineHostId}",host_name="prometheus-online-host"} 45`
        );

        expect(body).toContain(
            `pulseiq_network_receive_bytes_per_second{host_id="${onlineHostId}",host_name="prometheus-online-host"} 2560`
        );
        expect(body).toContain(
            `pulseiq_network_transmit_bytes_per_second{host_id="${onlineHostId}",host_name="prometheus-online-host"} 3584`
        );

        expect(body).not.toContain(
            `pulseiq_cpu_usage_percent{host_id="${pendingHostId}"`
        );
    });

    test('omits invalid values stored directly in the database', async () => {
        process.env.PROMETHEUS_METRICS_TOKEN = 'test-prometheus-secret';

        await pool.query(
            `INSERT INTO metrics
                (host_id, timestamp, collected_at,
                 cpu_usage, memory_usage, disk_usage, network_in, network_out)
             VALUES
                ($1, NOW(), NOW(),
                 101, -1, 'NaN'::FLOAT, -1, 'Infinity'::FLOAT)`,
            [onlineHostId]
        );

        const response = await request(app)
            .get('/metrics')
            .set('Authorization', 'Bearer test-prometheus-secret');

        expect(response.status).toBe(200);

        const body = response.text;
        const hostLabel = `{host_id="${onlineHostId}",host_name="prometheus-online-host"}`;

        expect(body).not.toContain(`pulseiq_cpu_usage_percent${hostLabel}`);
        expect(body).not.toContain(`pulseiq_memory_usage_percent${hostLabel}`);
        expect(body).not.toContain(`pulseiq_disk_usage_percent${hostLabel}`);
        expect(body).not.toContain(`pulseiq_network_receive_bytes_per_second${hostLabel}`);
        expect(body).not.toContain(`pulseiq_network_transmit_bytes_per_second${hostLabel}`);
    });
});
