const jwt = require('jsonwebtoken');

const JWT_SECRET = require('../config/jwt');

const authenticate = (req, res, next) => {

    try {

        const authHeader =
            req.headers.authorization;

        if (!authHeader) {
            return res.status(401).json({
                error: 'Access denied'
            });
        }

        const token =
            authHeader.split(' ')[1];

        if (!token) {
            return res.status(401).json({
                error: 'Invalid token'
            });
        }

        const decoded =
            jwt.verify(token, JWT_SECRET);

        req.user = decoded;

        next();

    } catch (err) {

        console.error('Auth middleware error:', err);

        return res.status(401).json({
            error: 'Unauthorized'
        });

    }

};

module.exports = authenticate;