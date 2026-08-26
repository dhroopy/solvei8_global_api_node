const { MongoClient } = require('mongodb');
const moment = require('moment-timezone');

const MONGO_URL = process.env.MONGODB_URL;
const DB_NAME = process.env.MONGODB_DB_NAME || 'supermanager_global';
const COLLECTION = 'env_registry';
const LOG_TZ = 'Asia/Kolkata';

let db;

async function connect() {
  if (db) return db;
  const client = new MongoClient(MONGO_URL);
  await client.connect();
  db = client.db(DB_NAME);
  // One document per factory — each new report overwrites the previous
  // snapshot for that factory, since only the LATEST config is useful
  // here, not a history of every past env.
  await db.collection(COLLECTION).createIndex({ factory_id: 1 }, { unique: true });
  console.log('[global] env_registry collection ready');
  return db;
}

async function upsertEnv(factory_id, env) {
  const database = await connect();
  const now = moment().tz(LOG_TZ).format('YYYY-MM-DD HH:mm:ss');
  await database.collection(COLLECTION).updateOne(
    { factory_id },
    {
      $set: { factory_id, env, updated_at: now },
      $setOnInsert: { first_reported_at: now },
    },
    { upsert: true }
  );
}

// Simple list — one row per factory, latest snapshot only, so
// pagination is lighter-weight here than the log tabs (there's only
// ever as many rows as there are factories, not as many as there are
// events).
async function getEnvSnapshots({ factory_id, page = 1, limit = 50 }) {
  const database = await connect();
  const filter = {};
  if (factory_id) filter.factory_id = factory_id;

  const safePage = Math.max(parseInt(page, 10) || 1, 1);
  const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200);
  const skip = (safePage - 1) * safeLimit;

  const [rows, total] = await Promise.all([
    database.collection(COLLECTION)
      .find(filter)
      .sort({ updated_at: -1 })
      .skip(skip)
      .limit(safeLimit)
      .toArray(),
    database.collection(COLLECTION).countDocuments(filter),
  ]);

  return { rows, total, page: safePage, limit: safeLimit, totalPages: Math.ceil(total / safeLimit) };
}

module.exports = { connect, upsertEnv, getEnvSnapshots };
