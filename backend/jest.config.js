module.exports = {
    testEnvironment: 'node',
    setupFiles: ['<rootDir>/tests/setup/env.js'],
    globalSetup: '<rootDir>/tests/setup/globalSetup.js',
    testMatch: ['<rootDir>/tests/**/*.test.js'],
    testTimeout: 15000
};
