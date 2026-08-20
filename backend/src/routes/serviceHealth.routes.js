const express = require("express");

const {
  getServiceHealthController,
} = require("../controllers/serviceHealth.controller");

const router = express.Router();

router.get("/", getServiceHealthController);

module.exports = router;