const { MongoClient } = require('mongodb');

const MONGO_URL = process.env.MONGODB_URL;
const DB_NAME = process.env.MONGODB_DB_NAME || 'supermanager_global';
const COLLECTION = 'api_logs';

// The 3 endpoints actually exposed to the SolveI8 team — everything
// else (internal /global/*, /devices, /logs/*, /health) is deliberately
// excluded by default so this tab stays focused on what SolveI8 debugs
// against, without needing to filter out internal traffic manually.
const SOLVEI8_PATHS = [
  '/ext/api/v1/operationBreakdown',
  '/ext/api/v1/lineSetup',
  '/ext/api/v1/tagMapping',
];

let db;

async function connect() {
  if (db) return db;
  const client = new MongoClient(MONGO_URL);
  await client.connect();
  db = client.db(DB_NAME);
  await db.collection(COLLECTION).createIndex({ timestamp: -1 });
  await db.collection(COLLECTION).createIndex({ path: 1 });
  await db.collection(COLLECTION).createIndex({ factory_id: 1 });
  await db.collection(COLLECTION).createIndex({ searchText: 'text' });
  console.log('[global] api_logs collection ready');
  return db;
}

async function insertLog(logEntry) {
  const database = await connect();
  await database.collection(COLLECTION).insertOne(logEntry);
}

// factory_id       - exact match
// path             - 'all' (any of the 3 SolveI8 endpoints, default),
//                     or one specific full path to narrow further
// search           - substring match against the flattened request
//                     body (backs Tag ID / RFID / OB ID / Device ID
//                     filters on the frontend — all just feed this)
// startDate/endDate - 'YYYY-MM-DD', filters on the timestamp string
//                     (safe to compare lexicographically since it's a
//                     fixed 'YYYY-MM-DD HH:mm:ss' format)
async function getLogs({ factory_id, path, search, startDate, endDate, page = 1, limit = 50 }) {
  const database = await connect();
  const filter = {};
  if (factory_id) filter.factory_id = factory_id;

  if (path && path !== 'all') {
    filter.path = path;
  } else {
    filter.path = { $in: SOLVEI8_PATHS };
  }

  if (search) {
    filter.searchText = { $regex: search.toLowerCase().trim(), $options: 'i' };
  }

  if (startDate || endDate) {
    filter.timestamp = {};
    if (startDate) filter.timestamp.$gte = `${startDate} 00:00:00`;
    if (endDate) filter.timestamp.$lte = `${endDate} 23:59:59`;
  }

  const safePage = Math.max(parseInt(page, 10) || 1, 1);
  const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200);
  const skip = (safePage - 1) * safeLimit;

  const [rows, total] = await Promise.all([
    database.collection(COLLECTION)
      .find(filter)
      .sort({ _id: -1 })
      .skip(skip)
      .limit(safeLimit)
      .toArray(),
    database.collection(COLLECTION).countDocuments(filter),
  ]);

  return { rows, total, page: safePage, limit: safeLimit, totalPages: Math.ceil(total / safeLimit) };
}

module.exports = { connect, insertLog, getLogs, SOLVEI8_PATHS };