const stagedModel = require('../models/staged.model');
const { asyncHandler, ok, badRequest } = require('../utils/response');

// GET /global/pull?factory_id=X
// Local server calls this — either because a GL/{factory_id} MQTT ping
// arrived, its 10-minute timer fired, or its connection just came back
// up. Returns everything unsynced for this factory. Does NOT mark
// anything synced — that's a separate, explicit step (ack below), so a
// Local server crash between pull and processing doesn't silently lose
// data.
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

// POST /global/ack
// Body: { factory_id, unique_ids: [...] }
// Local calls this AFTER successfully processing what it pulled — only
// the ids it actually confirms get marked synced. If Local only managed
// to process some of a batch (e.g. crashed partway through), whatever
// it doesn't ack stays unsynced and comes back on the next pull.
const ack = asyncHandler(async (req, res) => {
  const { factory_id, unique_ids } = req.body;
  if (!factory_id) return badRequest(res, 'factory_id is required');
  if (!Array.isArray(unique_ids) || !unique_ids.length) {
    return badRequest(res, 'unique_ids[] is required');
  }

  const modifiedCount = await stagedModel.markSynced(unique_ids);

  // "counting ack" — surface the mismatch rather than hiding it, so
  // Local knows if something it thought it acked didn't actually exist
  // (e.g. already acked earlier, or a stale unique_id).
  if (modifiedCount !== unique_ids.length) {
    console.warn(`[global] ack count mismatch for factory ${factory_id}: sent ${unique_ids.length}, matched ${modifiedCount}`);
  }

  return ok(res, { factory_id, acked: modifiedCount, requested: unique_ids.length });
});

module.exports = { pull, ack };
