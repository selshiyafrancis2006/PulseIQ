import { test, expect } from '@playwright/test';

const API = 'http://127.0.0.1:5051';

test('user can sign up, navigate to Metrics Explorer, and view ingested metrics', async ({ page, request }) => {
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const email = `e2e-metrics-${suffix}@test.dev`;
    const hostName = `e2e-metrics-host-${suffix}`;

    await page.goto('/login');

    await page.getByRole('button', { name: 'Sign Up' }).click();

    await expect(
        page.getByRole('heading', { name: 'Create account' })
    ).toBeVisible();

    await page.locator('input[type="email"]').fill(email);
    await page.locator('input[type="password"]').fill('password123');

    await page.getByRole('button', { name: /Create Account/ }).click();

    await expect(page).toHaveURL(/\/dashboard$/);

    await expect(
        page.getByRole('link', { name: 'Overview' })
    ).toBeVisible();

    const token = await page.evaluate(
        () => localStorage.getItem('token')
    );

    expect(token).toBeTruthy();

    // Register a host owned by this test user.
    const hostResponse = await request.post(`${API}/api/hosts/register`, {
        headers: {
            Authorization: `Bearer ${token}`
        },
        data: {
            name: hostName
        }
    });

    expect(hostResponse.ok()).toBeTruthy();

    const { api_key: apiKey } = await hostResponse.json();
    expect(apiKey).toBeTruthy();

    // Use the previous completed UTC minute so the sample falls
    // inside the aligned five-minute query window.
    const collectedAt = new Date(
        Math.floor(Date.now() / 60000) * 60000 - 60000
    ).toISOString();

    const metricResponse = await request.post(
        `${API}/api/agent/metrics`,
        {
            headers: {
                'x-api-key': apiKey
            },
            data: {
                cpu_usage: 42.5,
                memory_usage: 31.25,
                disk_usage: 20,
                network_in: 12.5,
                network_out: 5.5,
                collected_at: collectedAt
            }
        }
    );

    expect(metricResponse.ok()).toBeTruthy();

    await page.getByRole('link', { name: 'Metrics' }).click();

    await expect(page).toHaveURL(/\/metrics$/);

    await expect(
        page.getByRole('heading', { name: 'Metrics Explorer' })
    ).toBeVisible();

    await page.getByLabel('Time Range').selectOption('5m');

    // Verify the actual ingested CPU value appears in the table.
    await expect(
        page.getByRole('table').getByText('42.50%', { exact: true })
    ).toBeVisible({ timeout: 15000 });
});
