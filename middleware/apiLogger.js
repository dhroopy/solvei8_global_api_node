const moment = require('moment-timezone');
const apiLogModel = require('../models/apiLog.model');

const LOG_TZ = 'Asia/Kolkata';

// Pulls factory_id out of whatever shape the request actually has it in —
// covers all of: the 3 SolveI8 ingest endpoints (factories[0].factoryId
// in the body), /global/pull (factory_id as a query param), and
// /global/ack + /global/trigger-* (factory_id in the body).
function extractFactoryId(req) {
  if (req.query && req.query.factory_id) return req.query.factory_id;
  if (req.body && req.body.factory_id) return req.body.factory_id;
  if (req.body && Array.isArray(req.body.factories) && req.body.factories[0]) {
    return req.body.factories[0].factoryId || null;
  }
  return null;
}

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
      factory_id: extractFactoryId(req),
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
