const { MongoClient } = require('mongodb');
const moment = require('moment-timezone');

const MONGO_URL = process.env.MONGODB_URL;
const DB_NAME = process.env.MONGODB_DB_NAME || 'supermanager_global';
const COLLECTION = 'device_mqtt_logs';
const LOG_TZ = 'Asia/Kolkata';

let db;

async function connect() {
  if (db) return db;
  const client = new MongoClient(MONGO_URL);
  await client.connect();
  db = client.db(DB_NAME);
  await db.collection(COLLECTION).createIndex({ factory_id: 1, created_at: -1 });
  await db.collection(COLLECTION).createIndex({ device_id: 1 });
  console.log('[global] device_mqtt_logs collection ready');
  return db;
}

async function insertLog({ factory_id, device_id, direction, topic, msg_type, payload, created_at }) {
  const database = await connect();
  const doc = {
    factory_id,
    device_id,
    direction,
    topic,
    msg_type: msg_type || null,
    payload,
    created_at: created_at || moment().tz(LOG_TZ).format('YYYY-MM-DD HH:mm:ss.SSS'),
    received_at: moment().tz(LOG_TZ).format('YYYY-MM-DD HH:mm:ss'),
  };
  await database.collection(COLLECTION).insertOne(doc);
  return doc;
}

async function insertLogsBulk(entries) {
  if (!entries || !entries.length) return { inserted: 0 };
  const database = await connect();
  const receivedAt = moment().tz(LOG_TZ).format('YYYY-MM-DD HH:mm:ss');
  const docs = entries.map((e) => ({
    factory_id: e.factory_id,
    device_id: e.device_id,
    direction: e.direction,
    topic: e.topic,
    msg_type: e.msg_type || null,
    payload: e.payload,
    created_at: e.created_at || receivedAt,
    received_at: receivedAt,
  }));
  const result = await database.collection(COLLECTION).insertMany(docs);
  return { inserted: result.insertedCount };
}

// factory_id, device_id, direction - exact match
// startDate/endDate                - filters on created_at
async function getLogs({ factory_id, device_id, direction, startDate, endDate, page = 1, limit = 50 }) {
  const database = await connect();
  const filter = {};
  if (factory_id) filter.factory_id = factory_id;
  if (device_id) filter.device_id = device_id;
  if (direction) filter.direction = direction;
  if (startDate || endDate) {
    filter.created_at = {};
    if (startDate) filter.created_at.$gte = `${startDate} 00:00:00`;
    if (endDate) filter.created_at.$lte = `${endDate} 23:59:59.999`;
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

module.exports = { connect, insertLog, insertLogsBulk, getLogs };