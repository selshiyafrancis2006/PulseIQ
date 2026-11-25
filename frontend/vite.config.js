import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const repositoryRoot = fileURLToPath(new URL('..', import.meta.url))

export default defineConfig({
  server: {
    fs: {
      allow: [repositoryRoot],
    },
  },
  plugins: [
    react(),
    tailwindcss(),
  ],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.js'],
    include: ['src/**/*.test.{js,jsx}'],
    // Slow machines spend minutes starting jsdom under coverage; the default
    // 5s limit then fails tests that are not actually broken.
    testTimeout: 20000,
    hookTimeout: 20000,
    coverage: {
      provider: 'v8',
      include: [
        'src/pages/Metrics.jsx',
        'src/components/metrics/**/*.jsx',
        'src/hooks/useLiveSocket.js',
        'src/hooks/usePageVisible.js',
        'src/utils/metric*.js',
      ],
      exclude: ['**/*.test.{js,jsx}'],
      thresholds: { statements: 70, lines: 70, functions: 65, branches: 60 },
    },
  },
})