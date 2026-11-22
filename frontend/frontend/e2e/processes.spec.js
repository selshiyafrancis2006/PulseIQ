import { test, expect } from '@playwright/test';

const API = 'http://127.0.0.1:5051';

// An agent reports its processes; the Processes page shows them for that host
// only, and the old server-wide list no longer exists.
test('processes reported by an agent appear on the Processes page', async ({ page, request }) => {
    const email = `e2e-proc-${Date.now()}-${Math.random().toString(16).slice(2)}@test.dev`;

    const register = await request.post(`${API}/api/auth/register`, {
        data: { email, password: 'password123' }
    });
    const { token } = await register.json();

    const host = await request.post(`${API}/api/hosts/register`, {
        headers: { Authorization: `Bearer ${token}` },
        data: { name: 'e2e-proc-host' }
    });
    const { api_key: apiKey } = await host.json();

    const sent = await request.post(`${API}/api/agent/processes`, {
        headers: { 'x-api-key': apiKey },
        data: {
            collected_at: new Date().toISOString(),
            processes: [
                { pid: 4242, name: 'e2e-busy-process', cpu: 42.5, memory_mb: 512 },
                { pid: 4343, name: 'e2e-quiet-process', cpu: 0, memory_mb: 16 }
            ]
        }
    });
    expect(sent.status()).toBe(201);

    await page.addInitScript((value) => localStorage.setItem('token', value), token);
    await page.goto('/processes');

    const table = page.getByRole('table');

    await expect(table.getByText('e2e-busy-process')).toBeVisible();
    await expect(table.getByText('e2e-quiet-process')).toBeVisible();
    await expect(table.getByText('Running')).toBeVisible();

    const oldList = await request.get(`${API}/api/processes`, {
        headers: { Authorization: `Bearer ${token}` }
    });
    expect(oldList.status()).toBe(404);
});