const apiLogModel = require('../models/apiLog.model');
const stagedModel = require('../models/staged.model');
const deviceMqttLogModel = require('../models/deviceMqttLog.model');
const deviceRegistryModel = require('../models/deviceRegistry.model');
const { asyncHandler, ok, created, badRequest } = require('../utils/response');

// GET /logs/api-triggers?factory_id=X&page=1&limit=50
const getApiTriggerLogs = asyncHandler(async (req, res) => {
  const { factory_id, page, limit } = req.query;
  const result = await apiLogModel.getLogs({ factory_id, page, limit });
  return ok(res, result);
});

// GET /logs/sync?factory_id=X&page=1&limit=50
const getSyncLogs = asyncHandler(async (req, res) => {
  const { factory_id, page, limit } = req.query;
  const result = await stagedModel.getSyncLogs({ factory_id, page, limit });
  return ok(res, result);
});

// Best-effort registry update — never let a registry write failure
// break the actual log ingest, which is the thing that must not fail.
function updateRegistrySafely(entry) {
  deviceRegistryModel.recordFromLog(entry).catch((err) => {
    console.error('[device-registry] failed to update from log:', err.message);
  });
}

// POST /logs/device-mqtt
// Local servers forward their own mqtt_debug_log rows here, tagged with
// factory_id. Accepts either a single log object or { logs: [...] } for
// bulk forwarding. Every entry also updates device_registry (mac,
// fw_version, last message, last message time) — same write, two
// purposes.
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

// GET /logs/device-mqtt?factory_id=X&device_id=Y&direction=IN&page=1&limit=50
const getDeviceMqttLogs = asyncHandler(async (req, res) => {
  const { factory_id, device_id, direction, page, limit } = req.query;
  const result = await deviceMqttLogModel.getLogs({ factory_id, device_id, direction, page, limit });
  return ok(res, result);
});

// GET /devices?factory_id=X&page=1&limit=50
const getDevices = asyncHandler(async (req, res) => {
  const { factory_id, page, limit } = req.query;
  const result = await deviceRegistryModel.getDevices({ factory_id, page, limit });
  return ok(res, result);
});

module.exports = { getApiTriggerLogs, getSyncLogs, ingestDeviceMqttLog, getDeviceMqttLogs, getDevices };