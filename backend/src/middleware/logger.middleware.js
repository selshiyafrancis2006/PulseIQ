const pool = require("../config/db");

async function loggerMiddleware(req, res, next) {

  // Avoid logging log fetching requests
  if (req.originalUrl.startsWith("/api/logs")) {
    return next();
  }

  const startTime = Date.now();

  res.on("finish", async () => {
    try {
      const responseTime = Date.now() - startTime;

      await pool.query(
        `
        INSERT INTO logs (
          level,
          service,
          source,
          method,
          endpoint,
          status_code,
          response_time_ms,
          ip_address,
          message
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
        `,
        [
          res.statusCode >= 500
            ? "ERROR"
            : res.statusCode >= 400
            ? "WARN"
            : "INFO",

          "PulseIQ Backend",

          "Express",

          req.method,

          req.originalUrl,

          res.statusCode,

          responseTime,

          req.ip,

          `${req.method} ${req.originalUrl} responded with ${res.statusCode}`,
        ]
      );

    } catch (err) {
      console.error(
        "Logger Middleware:",
        err.message
      );
    }
  });

  next();
}

module.exports = loggerMiddleware;