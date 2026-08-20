const express = require("express");

const router = express.Router();

const {
  getLogs,
} = require("../controllers/logs.controller");

router.get("/", getLogs);

module.exports = router;