if (process.env.NODE_ENV !== 'production') {
    require('dotenv').config();
}

const { server } = require('./src/app');

const PORT = process.env.PORT || 5000;

server.listen(PORT, () => {

    console.log(
        `Server running on port ${PORT}`
    );

});

console.log(
    'ENV:',
    process.env.NODE_ENV
);

console.log(
    'DB_HOST:',
    process.env.DB_HOST
);