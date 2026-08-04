const express = require('express');
const router = express.Router();

const ingest = require('../controllers/ingest.controller');
const sync = require('../controllers/sync.controller');

// SAME paths SolveI8 already calls today — no change on their side.
router.post('/ext/api/v1/operationBreakdown', ingest.receiveOperationBreakdown);
router.post('/ext/api/v1/lineSetup', ingest.receiveLineSetup);
router.post('/ext/api/v1/tagMapping', ingest.receiveTagMapping);

// Local server calls these.
router.get('/global/pull', sync.pull);
router.post('/global/ack', sync.ack);

module.exports = router;
