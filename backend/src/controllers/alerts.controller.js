const { fetchAlerts } = require('../services/alert.service');

const getAlerts = async (req, res) => {

    try {

            const alerts = await fetchAlerts();

        res.json(alerts);

    } catch (err) {

        console.error(err);

        res.status(500).json({
            error: 'Failed to fetch alerts'
        });

    }

};

module.exports = {
    getAlerts
};