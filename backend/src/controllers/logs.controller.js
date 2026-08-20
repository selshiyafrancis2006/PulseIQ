const logsService = require("../services/logs.service");

async function getLogs(req, res) {
  try {
    const logs = await logsService.getLogs(req.query);

    res.status(200).json(logs);
  } catch (err) {
    console.error("Get Logs:", err);

    res.status(500).json({
      message: "Failed to fetch logs.",
    });
  }
}

module.exports = {
  getLogs,
};