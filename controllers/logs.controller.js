const apiLogModel = require('../models/apiLog.model');
const stagedModel = require('../models/staged.model');
const deviceMqttLogModel = require('../models/deviceMqttLog.model');
const deviceRegistryModel = require('../models/deviceRegistry.model');
const envRegistryModel = require('../models/envRegistry.model');
const { asyncHandler, ok, created, badRequest } = require('../utils/response');

// GET /logs/api-triggers?factory_id=X&path=Y&search=Z&startDate=&endDate=&page=1&limit=50
const getApiTriggerLogs = asyncHandler(async (req, res) => {
  const { factory_id, path, search, startDate, endDate, page, limit } = req.query;
  const result = await apiLogModel.getLogs({ factory_id, path, search, startDate, endDate, page, limit });
  return ok(res, result);
});

// GET /logs/sync?factory_id=X&endpoint=Y&startDate=&endDate=&page=1&limit=50
const getSyncLogs = asyncHandler(async (req, res) => {
  const { factory_id, endpoint, startDate, endDate, page, limit } = req.query;
  const result = await stagedModel.getSyncLogs({ factory_id, endpoint, startDate, endDate, page, limit });
  return ok(res, result);
});

function updateRegistrySafely(entry) {
  deviceRegistryModel.recordFromLog(entry).catch((err) => {
    console.error('[device-registry] failed to update from log:', err.message);
  });
}

const ingestDeviceMqttLog = asyncHandler(async (req, res) => {
  const { factory_id, logs } = req.body;

  if (Array.isArray(logs)) {
    if (!factory_id) return badRequest(res, 'factory_id is required');
    const withFactory = logs.map((l) => ({ ...l, factory_id }));
    const result = await deviceMqttLogModel.insertLogsBulk(withFactory);
    withFactory.forEach(updateRegistrySafely);
    return created(res, result);
  }

  const { device_id, direction, topic, msg_type, payload, created_at } = req.body;
  if (!factory_id || !device_id || !direction || !topic) {
    return badRequest(res, 'factory_id, device_id, direction, and topic are required');
  }
  const doc = await deviceMqttLogModel.insertLog({ factory_id, device_id, direction, topic, msg_type, payload, created_at });
  updateRegistrySafely({ factory_id, device_id, direction, topic, msg_type, payload, created_at });
  return created(res, doc);
});

// GET /logs/device-mqtt?factory_id=X&device_id=Y&direction=IN&startDate=&endDate=&page=1&limit=50
const getDeviceMqttLogs = asyncHandler(async (req, res) => {
  const { factory_id, device_id, direction, startDate, endDate, page, limit } = req.query;
  const result = await deviceMqttLogModel.getLogs({ factory_id, device_id, direction, startDate, endDate, page, limit });
  return ok(res, result);
});

// GET /devices?factory_id=X&startDate=&endDate=&page=1&limit=50
const getDevices = asyncHandler(async (req, res) => {
  const { factory_id, startDate, endDate, page, limit } = req.query;
  const result = await deviceRegistryModel.getDevices({ factory_id, startDate, endDate, page, limit });
  return ok(res, result);
});

const ENV_SENSITIVE_PATTERN = /PASS|PWD|SECRET|KEY|TOKEN|CREDENTIAL/i;
function redactEnvServerSide(env) {
  const redacted = {};
  for (const [key, value] of Object.entries(env || {})) {
    redacted[key] = ENV_SENSITIVE_PATTERN.test(key) ? '***REDACTED***' : value;
  }
  return redacted;
}

const ingestEnv = asyncHandler(async (req, res) => {
  const { factory_id, env } = req.body;
  if (!factory_id) return badRequest(res, 'factory_id is required');
  if (!env || typeof env !== 'object') return badRequest(res, 'env object is required');

  await envRegistryModel.upsertEnv(factory_id, redactEnvServerSide(env));
  return created(res, { factory_id, stored: true });
});

// GET /logs/env?factory_id=X&startDate=&endDate=&page=1&limit=50
const getEnvSnapshots = asyncHandler(async (req, res) => {
  const { factory_id, startDate, endDate, page, limit } = req.query;
  const result = await envRegistryModel.getEnvSnapshots({ factory_id, startDate, endDate, page, limit });
  return ok(res, result);
});

module.exports = { getApiTriggerLogs, getSyncLogs, ingestDeviceMqttLog, getDeviceMqttLogs, getDevices, ingestEnv, getEnvSnapshots };