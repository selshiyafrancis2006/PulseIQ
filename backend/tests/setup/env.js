
const path = require('path');
const dotenv = require('dotenv');

// Load the project-root .env so tests can use POSTGRES_PASSWORD.
// Existing process.env values take precedence.
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

// Tests must never connect to the development database.
process.env.NODE_ENV = 'test';

process.env.DB_HOST =
    process.env.TEST_DB_HOST || 'localhost';

process.env.DB_PORT =
    process.env.TEST_DB_PORT || '5433';

process.env.DB_USER =
    process.env.TEST_DB_USER || 'postgres';

process.env.DB_PASSWORD =
    process.env.TEST_DB_PASSWORD ||
    process.env.POSTGRES_PASSWORD ||
    process.env.DB_PASSWORD;

process.env.DB_NAME =
    process.env.TEST_DB_NAME || 'pulseiq_test';

if (!process.env.DB_NAME.endsWith('_test')) {
    throw new Error(
        `Refusing to run tests against "${process.env.DB_NAME}". ` +
        'The test database name must end with "_test" because tests wipe all data.'
    );
}

if (!process.env.DB_PASSWORD) {
    throw new Error(
        'Test database password is missing. Set TEST_DB_PASSWORD or POSTGRES_PASSWORD.'
    );
}
