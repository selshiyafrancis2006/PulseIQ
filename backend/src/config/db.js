const { Pool } = require('pg');
const dotenv = require('dotenv');
dotenv.config();

const pool = new Pool ({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: process.env.DB_PORT,
});

pool.connect((err, client, release) => {
    if (err) {
        console.error('Database connection failed:', err);
    }
    else {
        // Return the startup connection to the pool instead of holding it forever
        release();
        console.log('Connected to Postgres Successfully!');
    }
});

module.exports = pool;