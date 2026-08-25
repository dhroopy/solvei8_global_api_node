const express = require('express');
const router = express.Router();

const ingest = require('../controllers/ingest.controller');
const sync = require('../controllers/sync.controller');
const logs = require('../controllers/logs.controller');

// SAME paths SolveI8 already calls today — no change on their side.
router.post('/ext/api/v1/operationBreakdown', ingest.receiveOperationBreakdown);
router.post('/ext/api/v1/lineSetup', ingest.receiveLineSetup);
router.post('/ext/api/v1/tagMapping', ingest.receiveTagMapping);

// Local server calls these.
router.get('/global/pull', sync.pull);
router.post('/global/ack', sync.ack);
router.post('/global/trigger-pull', sync.triggerPull);
router.post('/global/trigger-ota', sync.triggerOta);

// Log query APIs (backing the dashboard's 3 log tabs)
router.get('/logs/api-triggers', logs.getApiTriggerLogs);
router.get('/logs/sync', logs.getSyncLogs);
router.post('/logs/device-mqtt', logs.ingestDeviceMqttLog);
router.get('/logs/device-mqtt', logs.getDeviceMqttLogs);

module.exports = router;
