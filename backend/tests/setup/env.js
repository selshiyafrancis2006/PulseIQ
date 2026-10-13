
// Tests must never connect to the development database.
process.env.NODE_ENV = 'test';

process.env.DB_HOST =
    process.env.TEST_DB_HOST || process.env.DB_HOST || 'localhost';

process.env.DB_PORT =
    process.env.TEST_DB_PORT || process.env.DB_PORT || '5433';

process.env.DB_USER =
    process.env.TEST_DB_USER || process.env.DB_USER || 'postgres';

process.env.DB_PASSWORD =
    process.env.TEST_DB_PASSWORD || process.env.DB_PASSWORD || 'postgres123d';

process.env.DB_NAME =
    process.env.TEST_DB_NAME || process.env.DB_NAME || 'pulseiq_test';

if (!process.env.DB_NAME.endsWith('_test')) {
    throw new Error(
        `Refusing to run tests against "${process.env.DB_NAME}". ` +
        'The test database name must end with "_test" because tests wipe all data.'
    );
}