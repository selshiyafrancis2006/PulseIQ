import { defineConfig } from '@playwright/test';

export default defineConfig({
    testDir: './e2e',
    fullyParallel: false,
    retries: 0,
    reporter: 'list',

    use: {
        baseURL: 'http://127.0.0.1:5174',
        browserName: 'chromium',
        headless: true,
    },

    webServer: [
        {
            command: 'node tests/e2e-server.cjs',
            cwd: '../backend',
            url: 'http://127.0.0.1:5051/',
            env: {
                PORT: '5051',
                CORS_ORIGINS: 'http://127.0.0.1:5174',
            },
            reuseExistingServer: false,
            timeout: 60000,
        },
        {
            command: 'npm run dev -- --host 127.0.0.1 --port 5174 --strictPort',
            cwd: '.',
            url: 'http://127.0.0.1:5174',
            env: {
                VITE_API_URL: 'http://127.0.0.1:5051',
                VITE_WS_URL: 'ws://127.0.0.1:5051',
            },
            reuseExistingServer: false,
            timeout: 60000,
        },
    ],
});
