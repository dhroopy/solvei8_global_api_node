function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

function ok(res, data) {
  return res.status(200).json({ statusCode: 200, data });
}

function created(res, data) {
  return res.status(201).json({ statusCode: 201, data });
}

function badRequest(res, message) {
  return res.status(400).json({ statusCode: 400, error: message });
}

function serverError(res, message) {
  return res.status(500).json({ statusCode: 500, error: message });
}

module.exports = { asyncHandler, ok, created, badRequest, serverError };
