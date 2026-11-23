import { test, expect } from '@playwright/test';

const API = 'http://127.0.0.1:5051';

test('user can register a host and see it in the Hosts list', async ({ page, request }) => {
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const email = `e2e-host-${suffix}@test.dev`;
    const hostName = `e2e-host-${suffix}`;

    const register = await request.post(`${API}/api/auth/register`, {
        data: { email, password: 'password123' }
    });

    expect(register.ok()).toBeTruthy();

    const { token } = await register.json();
    expect(token).toBeTruthy();

    await page.addInitScript(
        (value) => localStorage.setItem('token', value),
        token
    );

    await page.goto('/hosts');

    await expect(
        page.getByRole('heading', { name: 'Hosts' })
    ).toBeVisible();

    await page.getByRole('button', { name: '+ Add Host' }).click();
    await page.getByPlaceholder('e.g. prod-api-1').fill(hostName);
    await page.getByPlaceholder('env:prod, region:us-east')
        .fill('env:test, region:ap-south');

    await page.getByRole('button', { name: 'Register' }).click();

    await expect(
        page.getByRole('heading', { name: `${hostName} registered` })
    ).toBeVisible();

    await expect(page.locator('code')).not.toBeEmpty();

    await page.getByRole('button', { name: 'Done' }).click();

    const hostRow = page.getByRole('row').filter({ hasText: hostName });

    await expect(hostRow).toBeVisible();
    await expect(hostRow.getByText('Pending')).toBeVisible();
    await expect(hostRow.getByText('env:test')).toBeVisible();
    await expect(hostRow.getByText('region:ap-south')).toBeVisible();
});

