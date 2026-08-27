const { MongoClient } = require('mongodb');

const MONGO_URL = process.env.MONGODB_URL;
const DB_NAME = process.env.MONGODB_DB_NAME || 'supermanager_global';
const COLLECTION = 'api_logs';

let db;

async function connect() {
  if (db) return db;
  const client = new MongoClient(MONGO_URL);
  await client.connect();
  db = client.db(DB_NAME);
  await db.collection(COLLECTION).createIndex({ timestamp: -1 });
  await db.collection(COLLECTION).createIndex({ path: 1 });
  await db.collection(COLLECTION).createIndex({ factory_id: 1 });
  console.log('[global] api_logs collection ready');
  return db;
}

async function insertLog(logEntry) {
  const database = await connect();
  await database.collection(COLLECTION).insertOne(logEntry);
}

// Paginated query, newest first, optionally filtered by factory_id.
async function getLogs({ factory_id, page = 1, limit = 50 }) {
  const database = await connect();
  const filter = {};
  if (factory_id) filter.factory_id = factory_id;

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

module.exports = { connect, insertLog, getLogs };
