# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: auth-metrics.spec.js >> user can sign up, open dashboard, and navigate to Metrics Explorer
- Location: e2e\auth-metrics.spec.js:3:1

# Error details

```
Error: expect(page).toHaveURL(expected) failed

Expected pattern: /\/dashboard$/
Received string:  "http://127.0.0.1:5174/login"
Timeout: 5000ms

Call log:
  - Expect "toHaveURL" with timeout 5000ms
    14 × locator resolved to <html lang="en">…</html>
       - unexpected value "http://127.0.0.1:5174/login"

```

```yaml
- text: PulseIQ
- heading "Create account" [level=3]
- paragraph: Start monitoring for free
- button "Login"
- button "Sign Up"
- text: Cannot connect to server Email
- textbox "you@startup.com": e2e-1795190898735-bba556f904f6b@test.dev
- text: Password
- textbox "••••••••": password123
- button "Create Account →"
- paragraph: By continuing you agree to our terms of service
```

# Test source

```ts
  1  | ﻿import { test, expect } from '@playwright/test';
  2  | 
  3  | test('user can sign up, open dashboard, and navigate to Metrics Explorer', async ({ page }) => {
  4  |     const email = `e2e-${Date.now()}-${Math.random().toString(16).slice(2)}@test.dev`;
  5  | 
  6  |     await page.goto('/login');
  7  | 
  8  |     page.on('requestfailed', request => {
  9  |         console.log('REQUEST FAILED:', request.url());
  10 |         console.log('ERROR:', request.failure()?.errorText);
  11 |     });
  12 | 
  13 |     page.on('response', response => {
  14 |         if (response.url().includes('/api/auth/register')) {
  15 |             console.log('REGISTER RESPONSE:', response.status());
  16 |         }
  17 |     });
  18 | 
  19 | 
  20 |     await page.getByRole('button', { name: 'Sign Up' }).click();
  21 | 
  22 |     await expect(
  23 |         page.getByRole('heading', { name: 'Create account' })
  24 |     ).toBeVisible();
  25 | 
  26 |     await page.locator('input[type="email"]').fill(email);
  27 |     await page.locator('input[type="password"]').fill('password123');
  28 | 
  29 |     await page.getByRole('button', { name: /Create Account/ }).click();
  30 | 
> 31 |     await expect(page).toHaveURL(/\/dashboard$/);
     |                        ^ Error: expect(page).toHaveURL(expected) failed
  32 | 
  33 |     await expect(
  34 |         page.getByRole('link', { name: 'Overview' })
  35 |     ).toBeVisible();
  36 | 
  37 |     await page.getByRole('link', { name: 'Metrics' }).click();
  38 | 
  39 |     await expect(page).toHaveURL(/\/metrics$/);
  40 | 
  41 |     await expect(
  42 |         page.getByRole('heading', { name: 'Metrics Explorer' })
  43 |     ).toBeVisible();
  44 | });
  45 | 
  46 | 
```