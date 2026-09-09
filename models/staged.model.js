const { MongoClient } = require('mongodb');
const moment = require('moment-timezone');

const MONGO_URL = process.env.MONGODB_URL;
const DB_NAME = process.env.MONGODB_DB_NAME || 'supermanager_global';
const COLLECTION = 'staged_data';
const LOG_TZ = 'Asia/Kolkata';

let db;

async function connect() {
  if (db) return db;
  const client = new MongoClient(MONGO_URL);
  await client.connect();
  db = client.db(DB_NAME);
  await db.collection(COLLECTION).createIndex({ factory_id: 1, last_sync: 1 });
  await db.collection(COLLECTION).createIndex({ unique_id: 1 }, { unique: true });
  console.log('[global] MongoDB connected:', DB_NAME);
  return db;
}

function generateUniqueId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

async function insertStaged({ factory_id, endpoint, data }) {
  const database = await connect();
  const doc = {
    unique_id: generateUniqueId(),
    factory_id,
    endpoint,
    data,
    last_sync: null,
    doa: moment().tz(LOG_TZ).format('YYYY-MM-DD HH:mm:ss'),
  };
  await database.collection(COLLECTION).insertOne(doc);
  return doc;
}

async function getUnsynced(factory_id) {
  const database = await connect();
  return database.collection(COLLECTION)
    .find({ factory_id, last_sync: null })
    .sort({ _id: 1 })
    .toArray();
}

async function markSynced(unique_ids) {
  const database = await connect();
  const result = await database.collection(COLLECTION).updateMany(
    { unique_id: { $in: unique_ids } },
    { $set: { last_sync: moment().tz(LOG_TZ).format('YYYY-MM-DD HH:mm:ss') } }
  );
  return result.modifiedCount;
}

// factory_id        - exact match
// endpoint          - 'operationBreakdown' | 'lineSetup' | 'tagMapping'
// startDate/endDate - filters on doa
async function getSyncLogs({ factory_id, endpoint, startDate, endDate, page = 1, limit = 50 }) {
  const database = await connect();
  const filter = {};
  if (factory_id) filter.factory_id = factory_id;
  if (endpoint) filter.endpoint = endpoint;
  if (startDate || endDate) {
    filter.doa = {};
    if (startDate) filter.doa.$gte = `${startDate} 00:00:00`;
    if (endDate) filter.doa.$lte = `${endDate} 23:59:59`;
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

module.exports = { connect, insertStaged, getUnsynced, markSynced, getSyncLogs };