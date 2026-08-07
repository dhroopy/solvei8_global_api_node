const moment = require('moment-timezone');
const apiLogModel = require('../models/apiLog.model');

const LOG_TZ = 'Asia/Kolkata';

// Logs every API call — request and response — into MongoDB.
// Non-blocking: the log write happens after the response has already
// been sent, so a slow/failed Mongo write never delays or breaks an
// actual API response.
function apiLogger(req, res, next) {
  const startedAt = moment().tz(LOG_TZ);
  const startHrTime = process.hrtime.bigint();

  // Capture the response body without changing any existing behavior —
  // wrap res.json/res.send just long enough to see what was sent.
  let responseBody;
  const originalJson = res.json.bind(res);
  res.json = (body) => {
    responseBody = body;
    return originalJson(body);
  };

  res.on('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - startHrTime) / 1e6;

    const logEntry = {
      timestamp: startedAt.format('YYYY-MM-DD HH:mm:ss'), // Asia/Kolkata, as a string — avoids any ambiguity about which timezone a raw Date would display as later
      method: req.method,
      path: req.originalUrl,
      query: req.query,
      body: req.body,
      statusCode: res.statusCode,
      responseBody,
      durationMs: Math.round(durationMs),
      ip: req.ip,
    };

    apiLogModel.insertLog(logEntry).catch((err) => {
      console.error('[api-logger] failed to write log:', err.message);
    });
  });

  next();
}

module.exports = apiLogger;
