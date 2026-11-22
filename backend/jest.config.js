module.exports = {
    testEnvironment: 'node',
    setupFiles: ['<rootDir>/tests/setup/env.js'],
    globalSetup: '<rootDir>/tests/setup/globalSetup.js',
    testMatch: ['<rootDir>/tests/**/*.test.js'],
    testTimeout: 15000,

    // Coverage only runs with `npm run test:coverage`.
    collectCoverageFrom: [
        'src/services/metricRollup.service.js',
        'src/services/metricRollupHealth.service.js',
        'src/services/metricRollupAlert.service.js',
        'src/services/jobRunStore.service.js',
        'src/services/metricsQuery.service.js',
        'src/services/metrics.service.js',
        'src/controllers/metrics.controller.js',
        'src/controllers/metricRollupHealth.controller.js',
        'src/middleware/metricsQueryRateLimit.middleware.js',
        'src/jobs/rollup.job.js'
    ],
    coverageThreshold: {
        global: { statements: 75, lines: 75, functions: 75, branches: 60 }
    }
};