const { MongoClient } = require('mongodb');
const moment = require('moment-timezone');

const MONGO_URL = process.env.MONGODB_URL;
const DB_NAME = process.env.MONGODB_DB_NAME || 'supermanager_global';
const COLLECTION = 'device_registry';
const LOG_TZ = 'Asia/Kolkata';

let db;

async function connect() {
  if (db) return db;
  const client = new MongoClient(MONGO_URL);
  await client.connect();
  db = client.db(DB_NAME);
  await db.collection(COLLECTION).createIndex({ factory_id: 1, device_id: 1 }, { unique: true });
  await db.collection(COLLECTION).createIndex({ factory_id: 1 });
  console.log('[global] device_registry collection ready');
  return db;
}

async function recordFromLog({ factory_id, device_id, direction, topic, msg_type, payload, created_at }) {
  if (!factory_id || !device_id) return;

  const database = await connect();

  let parsed = null;
  try {
    parsed = typeof payload === 'string' ? JSON.parse(payload) : payload;
  } catch (e) {
    // not JSON — skip mac/fw extraction below
  }

  const update = {
    $set: {
      factory_id,
      device_id,
      last_msg: payload,
      last_msg_type: msg_type || null,
      last_msg_direction: direction,
      last_msg_topic: topic,
      last_msg_at: created_at || moment().tz(LOG_TZ).format('YYYY-MM-DD HH:mm:ss'),
      updated_at: moment().tz(LOG_TZ).format('YYYY-MM-DD HH:mm:ss'),
    },
    $setOnInsert: {
      first_seen_at: moment().tz(LOG_TZ).format('YYYY-MM-DD HH:mm:ss'),
    },
  };

  if (parsed && parsed.mac) update.$set.mac = parsed.mac;
  if (parsed && parsed.fw) update.$set.fw_version = parsed.fw;

  await database.collection(COLLECTION).updateOne(
    { factory_id, device_id },
    update,
    { upsert: true }
  );
}

// factory_id        - exact match
// startDate/endDate - filters on last_msg_at (i.e. "last seen within this range")
async function getDevices({ factory_id, startDate, endDate, page = 1, limit = 50 }) {
  const database = await connect();
  const filter = {};
  if (factory_id) filter.factory_id = factory_id;
  if (startDate || endDate) {
    filter.last_msg_at = {};
    if (startDate) filter.last_msg_at.$gte = `${startDate} 00:00:00`;
    if (endDate) filter.last_msg_at.$lte = `${endDate} 23:59:59`;
  }

  const safePage = Math.max(parseInt(page, 10) || 1, 1);
  const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200);
  const skip = (safePage - 1) * safeLimit;

  const [rows, total] = await Promise.all([
    database.collection(COLLECTION)
      .find(filter)
      .sort({ last_msg_at: -1 })
      .skip(skip)
      .limit(safeLimit)
      .toArray(),
    database.collection(COLLECTION).countDocuments(filter),
  ]);

  return { rows, total, page: safePage, limit: safeLimit, totalPages: Math.ceil(total / safeLimit) };
}

async function getDeviceIdsForFactory(factory_id) {
  const database = await connect();
  const rows = await database.collection(COLLECTION)
    .find({ factory_id })
    .project({ device_id: 1, _id: 0 })
    .toArray();
  return rows.map((r) => r.device_id);
}

module.exports = { connect, recordFromLog, getDevices, getDeviceIdsForFactory };