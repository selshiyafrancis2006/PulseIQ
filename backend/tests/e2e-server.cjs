require('./setup/env');

const setupDatabase = require('./setup/globalSetup');

setupDatabase()
    .then(() => {
        require('../server');
    })
    .catch((error) => {
        console.error('E2E database initialization failed:', error);
        process.exit(1);
    });
