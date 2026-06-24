const authService = require('../services/auth.service');

const registerUser = async (req, res) => {

    try {

        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({
                error: 'Email and password are required'
            });
        }

        if (password.length < 6) {
            return res.status(400).json({
                error: 'Password must be at least 6 characters'
            });
        }

        const data = await authService.register(email, password);

        res.json(data);

    } catch (err) {

        console.error('Register error:', err);

        if (err.message === 'EMAIL_EXISTS') {
            return res.status(400).json({
                error: 'Email already registered'
            });
        }

        res.status(500).json({
            error: 'Registration failed'
        });

    }

};

const loginUser = async (req, res) => {

    try {

        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({
                error: 'Email and password are required'
            });
        }

        const data = await authService.login(email, password);

        res.json(data);

    } catch (err) {

        console.error('Login error:', err);

        if (err.message === 'INVALID_CREDENTIALS') {
            return res.status(401).json({
                error: 'Invalid email or password'
            });
        }

        res.status(500).json({
            error: 'Login failed'
        });

    }

};

module.exports = {
    registerUser,
    loginUser
};