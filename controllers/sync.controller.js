const stagedModel = require('../models/staged.model');
const deviceRegistryModel = require('../models/deviceRegistry.model');
const globalMqtt = require('../services/globalMqtt');
const { asyncHandler, ok, badRequest } = require('../utils/response');

const pull = asyncHandler(async (req, res) => {
  const { factory_id } = req.query;
  if (!factory_id) return badRequest(res, 'factory_id is required');

  const records = await stagedModel.getUnsynced(factory_id);
  return ok(res, {
    factory_id,
    count: records.length,
    records: records.map((r) => ({
      unique_id: r.unique_id,
      endpoint: r.endpoint,
      data: r.data,
      doa: r.doa,
    })),
  });
});

const ack = asyncHandler(async (req, res) => {
  const { factory_id, unique_ids } = req.body;
  if (!factory_id) return badRequest(res, 'factory_id is required');
  if (!Array.isArray(unique_ids) || !unique_ids.length) {
    return badRequest(res, 'unique_ids[] is required');
  }

  const modifiedCount = await stagedModel.markSynced(unique_ids);
  if (modifiedCount !== unique_ids.length) {
    console.warn(`[global] ack count mismatch for factory ${factory_id}: sent ${unique_ids.length}, matched ${modifiedCount}`);
  }

  return ok(res, { factory_id, acked: modifiedCount, requested: unique_ids.length });
});

// POST /global/trigger-pull — Body: { factory_id }
const triggerPull = asyncHandler(async (req, res) => {
  const { factory_id } = req.body;
  if (!factory_id) return badRequest(res, 'factory_id is required');
  await globalMqtt.pingFactory(factory_id);
  return ok(res, { factory_id, triggered: true });
});

// POST /global/trigger-ota — Body: { factory_id }
// Container OTA — restarts the Local server's own Flovation API container.
const triggerOta = asyncHandler(async (req, res) => {
  const { factory_id } = req.body;
  if (!factory_id) return badRequest(res, 'factory_id is required');
  await globalMqtt.triggerFactoryUpdate(factory_id);
  return ok(res, { factory_id, otaTriggered: true });
});

// POST /global/trigger-device-ota — Body: { factory_id, device_id, otaFile }
// Device firmware OTA — relayed through the Local server to one
// specific device. otaFile must be a full, publicly reachable URL —
// this endpoint doesn't validate reachability, only that it looks like
// a URL, since the actual download happens device-side, out of this
// server's visibility.
const triggerDeviceOta = asyncHandler(async (req, res) => {
  const { factory_id, device_id, otaFile } = req.body;
  if (!factory_id) return badRequest(res, 'factory_id is required');
  if (!device_id) return badRequest(res, 'device_id is required');
  if (!otaFile || !/^https?:\/\//i.test(otaFile)) {
    return badRequest(res, 'otaFile must be a full http(s) URL');
  }
  await globalMqtt.triggerDeviceOta(factory_id, device_id, otaFile);
  return ok(res, { factory_id, device_id, otaFile, triggered: true });
});

// POST /global/trigger-device-ota-batch — Body: { factory_id, otaFile }
// Pushes the SAME firmware URL to every device currently registered for
// this factory. factory_id is required and NOT optional here — batching
// across every factory at once from a single click is too dangerous to
// allow by accident, so this endpoint only ever targets one factory per
// call, same as the single-device version.
const triggerDeviceOtaBatch = asyncHandler(async (req, res) => {
  const { factory_id, otaFile } = req.body;
  if (!factory_id) return badRequest(res, 'factory_id is required');
  if (!otaFile || !/^https?:\/\//i.test(otaFile)) {
    return badRequest(res, 'otaFile must be a full http(s) URL');
  }

  const deviceIds = await deviceRegistryModel.getDeviceIdsForFactory(factory_id);
  if (!deviceIds.length) {
    return badRequest(res, `No devices registered for factory ${factory_id}`);
  }

  // Fire all triggers concurrently — each is just a small MQTT publish,
  // not a heavy operation, so there's no need to queue or throttle
  // these one at a time.
  await Promise.all(deviceIds.map((device_id) => globalMqtt.triggerDeviceOta(factory_id, device_id, otaFile)));

  return ok(res, { factory_id, otaFile, deviceCount: deviceIds.length, deviceIds, triggered: true });
});

module.exports = { pull, ack, triggerPull, triggerOta, triggerDeviceOta, triggerDeviceOtaBatch };