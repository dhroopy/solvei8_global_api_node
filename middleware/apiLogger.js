const moment = require('moment-timezone');
const apiLogModel = require('../models/apiLog.model');

const LOG_TZ = 'Asia/Kolkata';

function extractFactoryId(req) {
  if (req.query && req.query.factory_id) return req.query.factory_id;
  if (req.body && req.body.factory_id) return req.body.factory_id;
  if (req.body && Array.isArray(req.body.factories) && req.body.factories[0]) {
    return req.body.factories[0].factoryId || null;
  }
  return null;
}

function apiLogger(req, res, next) {
  const startedAt = moment().tz(LOG_TZ);
  const startHrTime = process.hrtime.bigint();

  let responseBody;
  const originalJson = res.json.bind(res);
  res.json = (body) => {
    responseBody = body;
    return originalJson(body);
  };

  res.on('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - startHrTime) / 1e6;

    // Flattened, lowercased text of the whole request body — lets the
    // Tag ID / RFID / OB ID / Device ID filters all work as simple
    // substring search, without needing separate hand-written queries
    // for each endpoint's own nested structure (operationBreakdown,
    // lineSetup, and tagMapping all nest their identifying fields
    // differently — this sidesteps needing to know each shape).
    let searchText = '';
    try {
      searchText = JSON.stringify(req.body || {}).toLowerCase();
    } catch (e) {
      searchText = '';
    }

    const logEntry = {
      timestamp: startedAt.format('YYYY-MM-DD HH:mm:ss'),
      factory_id: extractFactoryId(req),
      method: req.method,
      path: req.originalUrl,
      query: req.query,
      body: req.body,
      searchText,
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