import { test, expect } from '@playwright/test';

test('user can sign up, open dashboard, and navigate to Metrics Explorer', async ({ page }) => {
    const email = `e2e-${Date.now()}-${Math.random().toString(16).slice(2)}@test.dev`;

    await page.goto('/login');

    page.on('requestfailed', request => {
        console.log('REQUEST FAILED:', request.url());
        console.log('ERROR:', request.failure()?.errorText);
    });

    page.on('response', response => {
        if (response.url().includes('/api/auth/register')) {
            console.log('REGISTER RESPONSE:', response.status());
        }
    });


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

    await page.getByRole('link', { name: 'Metrics' }).click();

    await expect(page).toHaveURL(/\/metrics$/);

    await expect(
        page.getByRole('heading', { name: 'Metrics Explorer' })
    ).toBeVisible();
});

