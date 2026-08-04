const stagedModel = require('../models/staged.model');
const globalMqtt = require('../services/globalMqtt');

// All three of these keep the EXACT same request/response shape SolveI8
// already calls today — badRequest/created helpers assumed to exist in
// your existing utils/response.js, same as the Local server's
// controllers. Swap these two lines if your actual helper module lives
// elsewhere.
const { asyncHandler, created, badRequest } = require('../utils/response');

// Shared logic for all three endpoints: SolveI8's payload is already
// factory-segmented ({ factories: [{ factoryId, ... }] }) — stage ONE
// record per factory, so a pull for a given factory_id gets exactly its
// own slice, nothing else mixed in.
async function stageByFactory(endpoint, factories) {
  const staged = [];
  for (const f of factories) {
    if (!f.factoryId) continue;
    const doc = await stagedModel.insertStaged({
      factory_id: f.factoryId,
      endpoint,
      data: f, // the whole per-factory object, unchanged
    });
    staged.push(doc);
    // Fire the "come pull" ping — fire-and-forget, doesn't block the
    // response back to SolveI8.
    globalMqtt.pingFactory(f.factoryId).catch((err) =>
      console.error('[global] ping failed for', f.factoryId, err.message)
    );
  }
  return staged;
}

const receiveOperationBreakdown = asyncHandler(async (req, res) => {
  const { factories } = req.body;
  if (!Array.isArray(factories) || !factories.length) {
    return badRequest(res, 'factories[] is required');
  }
  const staged = await stageByFactory('operationBreakdown', factories);
  return created(res, { factories: factories.length, staged: staged.length });
});

const receiveLineSetup = asyncHandler(async (req, res) => {
  const { factories } = req.body;
  if (!Array.isArray(factories) || !factories.length) {
    return badRequest(res, 'factories[] is required');
  }
  const staged = await stageByFactory('lineSetup', factories);
  return created(res, { factories: factories.length, staged: staged.length });
});

const receiveTagMapping = asyncHandler(async (req, res) => {
  const { factories, syncType, generatedAt } = req.body;
  if (!Array.isArray(factories) || !factories.length) {
    return badRequest(res, 'factories[] is required');
  }
  const factoriesWithSyncInfo = factories.map((f) => ({ ...f, syncType, generatedAt }));
  const staged = await stageByFactory('tagMapping', factoriesWithSyncInfo);
  return created(res, { factories: factories.length, staged: staged.length });
});

module.exports = { receiveOperationBreakdown, receiveLineSetup, receiveTagMapping };
