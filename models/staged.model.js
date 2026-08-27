const { MongoClient } = require('mongodb');

const MONGO_URL = process.env.MONGODB_URL; // put your existing connection string in .env
const DB_NAME = process.env.MONGODB_DB_NAME || 'supermanager_global';
const COLLECTION = 'staged_data';
const moment = require('moment-timezone');
const LOG_TZ = 'Asia/Kolkata';

let db;

async function connect() {
  if (db) return db;
  const client = new MongoClient(MONGO_URL);
  await client.connect();
  db = client.db(DB_NAME);
  // Indexes matter here — every pull query filters by factory_id +
  // last_sync, and acks look up by unique_id.
  await db.collection(COLLECTION).createIndex({ factory_id: 1, last_sync: 1 });
  await db.collection(COLLECTION).createIndex({ unique_id: 1 }, { unique: true });
  console.log('[global] MongoDB connected:', DB_NAME);
  return db;
}

function generateUniqueId() {
  // Simple, collision-resistant enough for this use case — timestamp +
  // random. Swap for a proper uuid package if you already have one as a
  // dependency.
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

// Stores one raw incoming record. Called once per logical item in the
// incoming payload — e.g. once per factory in a lineSetup push, or
// however granular you want "one record" to mean. See the controller
// for how it's actually chunked.
async function insertStaged({ factory_id, endpoint, data }) {
  const database = await connect();
  const doc = {
    unique_id: generateUniqueId(),
    factory_id,
    endpoint,       // 'operationBreakdown' | 'lineSetup' | 'tagMapping'
    data,           // the raw payload as received
    last_sync: null,
    doa: moment().tz(LOG_TZ).format('YYYY-MM-DD HH:mm:ss')
  };
  await database.collection(COLLECTION).insertOne(doc);
  return doc;
}

// Pull: everything unsynced for this factory. Does NOT mark synced —
// that only happens via acknowledgeSynced() once the Local server
// confirms it actually processed the data.
async function getUnsynced(factory_id) {
  const database = await connect();
  return database.collection(COLLECTION)
    .find({ factory_id, last_sync: null })
    .sort({ doa: 1 })
    .toArray();
}

// Ack: mark specific records as synced now, but only the ones whose
// unique_id was actually confirmed — never blindly mark "everything for
// this factory" synced, in case Local only managed to process some of
// what it pulled.
async function markSynced(unique_ids) {
  const database = await connect();
  const result = await database.collection(COLLECTION).updateMany(
    { unique_id: { $in: unique_ids } },
    { $set: { last_sync: moment().tz(LOG_TZ).format('YYYY-MM-DD HH:mm:ss') } }
  );
  return result.modifiedCount;
}

// "Sync logs" view — every staged record for a factory, synced or not,
// paginated, newest first (by doa — safe to sort on since it's a
// lexicographically-sortable 'YYYY-MM-DD HH:mm:ss' string). Distinct
// from getUnsynced(), which the pull endpoint uses and only ever
// returns pending ones.
async function getSyncLogs({ factory_id, page = 1, limit = 50 }) {
  const database = await connect();
  const filter = {};
  if (factory_id) filter.factory_id = factory_id;

  const safePage = Math.max(parseInt(page, 10) || 1, 1);
  const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200);
  const skip = (safePage - 1) * safeLimit;

  const [rows, total] = await Promise.all([
    database.collection(COLLECTION)
      .find(filter)
      .sort({ doa: -1 })
      .skip(skip)
      .limit(safeLimit)
      .toArray(),
    database.collection(COLLECTION).countDocuments(filter),
  ]);

  return { rows, total, page: safePage, limit: safeLimit, totalPages: Math.ceil(total / safeLimit) };
}

module.exports = { connect, insertStaged, getUnsynced, markSynced, getSyncLogs };
