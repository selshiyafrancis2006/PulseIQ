const {
    app,
    pool,
    resetDb,
    createUser,
    authHeader,
    request
} = require('./helpers');

const {
    getMaxMonitorsPerUser,
    DEFAULT_MAX_MONITORS_PER_USER
} = require('../src/config/limits');

const ORIGINAL_LIMIT = process.env.MAX_MONITORS_PER_USER;

beforeAll(async () => {
    await resetDb();
    process.env.MAX_MONITORS_PER_USER = '3';
});

afterAll(async () => {
    if (ORIGINAL_LIMIT === undefined) {
        delete process.env.MAX_MONITORS_PER_USER;
    } else {
        process.env.MAX_MONITORS_PER_USER = ORIGINAL_LIMIT;
    }

    await pool.end();
});

function create(token, name, extra = {}) {
    return request(app)
        .post('/api/monitors')
        .set(authHeader(token))
        .send({
            name,
            url: 'https://example.com',
            interval_seconds: 60,
            ...extra
        });
}

async function countMonitors(email) {
    const result = await pool.query(
        `SELECT COUNT(*)::int AS total
         FROM monitors m JOIN users u ON u.id = m.user_id
         WHERE u.email = $1`,
        [email]
    );
    return result.rows[0].total;
}

describe('getMaxMonitorsPerUser', () => {
    test.each([
        ['', DEFAULT_MAX_MONITORS_PER_USER],
        ['abc', DEFAULT_MAX_MONITORS_PER_USER],
        ['0', DEFAULT_MAX_MONITORS_PER_USER],
        ['-4', DEFAULT_MAX_MONITORS_PER_USER],
        ['2.5', DEFAULT_MAX_MONITORS_PER_USER],
        ['10001', DEFAULT_MAX_MONITORS_PER_USER],
        ['1', 1],
        ['25', 25],
        ['10000', 10000]
    ])('reads "%s" as %i', (value, expected) => {
        const saved = process.env.MAX_MONITORS_PER_USER;
        process.env.MAX_MONITORS_PER_USER = value;

        try {
            expect(getMaxMonitorsPerUser()).toBe(expected);
        } finally {
            process.env.MAX_MONITORS_PER_USER = saved;
        }
    });
});

describe('monitor limit per user', () => {
    test('allows monitors up to the limit and rejects the next one', async () => {
        const user = await createUser();

        for (let i = 1; i <= 3; i += 1) {
            const response = await create(user.token, `limit-${i}`);
            expect(response.status).toBe(201);
        }

        const blocked = await create(user.token, 'limit-4');

        expect(blocked.status).toBe(403);
        expect(blocked.body.message).toMatch(/Monitor limit reached \(3\)/);
        expect(await countMonitors(user.email)).toBe(3);
    });

    test('does not count against other users', async () => {
        const first = await createUser();
        const second = await createUser();

        for (let i = 1; i <= 3; i += 1) {
            await create(first.token, `first-${i}`);
        }

        const response = await create(second.token, 'second-1');
        expect(response.status).toBe(201);
    });

    test('frees a slot when a monitor is deleted', async () => {
        const user = await createUser();
        const ids = [];

        for (let i = 1; i <= 3; i += 1) {
            ids.push((await create(user.token, `free-${i}`)).body.id);
        }

        expect((await create(user.token, 'free-4')).status).toBe(403);

        const removed = await request(app)
            .delete(`/api/monitors/${ids[0]}`)
            .set(authHeader(user.token));
        expect(removed.status).toBe(200);

        expect((await create(user.token, 'free-4')).status).toBe(201);
    });

    test('counts paused monitors toward the limit', async () => {
        const user = await createUser();
        const ids = [];

        for (let i = 1; i <= 3; i += 1) {
            ids.push((await create(user.token, `pause-${i}`)).body.id);
        }

        await request(app)
            .patch(`/api/monitors/${ids[0]}/pause`)
            .set(authHeader(user.token));

        expect((await create(user.token, 'pause-4')).status).toBe(403);
    });

    test('never exceeds the limit when requests arrive in parallel', async () => {
        const user = await createUser();

        const responses = await Promise.all(
            Array.from({ length: 8 }, (_, i) => create(user.token, `race-${i}`))
        );

        const statuses = responses.map((response) => response.status);

        expect(statuses.filter((status) => status === 201)).toHaveLength(3);
        expect(statuses.filter((status) => status === 403)).toHaveLength(5);
        expect(await countMonitors(user.email)).toBe(3);
    });

    test('still creates heartbeat monitors with their secret', async () => {
        const user = await createUser();

        const response = await create(user.token, 'hb-limit', {
            monitor_type: 'HEARTBEAT',
            url: undefined
        });

        expect(response.status).toBe(201);
        expect(response.body.heartbeat_token).toMatch(/^[0-9a-f]{64}$/);

        const secret = await pool.query(
            'SELECT 1 FROM heartbeat_monitor_secrets WHERE monitor_id = $1',
            [response.body.id]
        );
        expect(secret.rows).toHaveLength(1);
    });
});