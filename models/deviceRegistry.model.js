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
  // One row per device — device_id is unique WITHIN a factory (two
  // factories could reuse the same device_id, e.g. both have a "16"),
  // so the real unique key is the pair.
  await db.collection(COLLECTION).createIndex({ factory_id: 1, device_id: 1 }, { unique: true });
  await db.collection(COLLECTION).createIndex({ factory_id: 1 });
  console.log('[global] device_registry collection ready');
  return db;
}

// Called on every forwarded device-mqtt log entry. Cheap upsert — always
// refreshes last_msg/last_msg_at regardless of message type, and ALSO
// pulls mac/fw_version out of it when present (only "status"/"DEBUG"
// heartbeat messages carry those — see mqtt_bridge.js's onStatus/
// onDeviceHeartbeat and the firmware's own periodic heartbeat publish).
async function recordFromLog({ factory_id, device_id, direction, topic, msg_type, payload, created_at }) {
  if (!factory_id || !device_id) return;

  const database = await connect();

  let parsed = null;
  try {
    parsed = typeof payload === 'string' ? JSON.parse(payload) : payload;
  } catch (e) {
    // payload wasn't JSON — fine, just skip mac/fw extraction below
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

  // mac and fw only ever show up together, on connect-status and
  // heartbeat messages — RSSI/uptime aren't tracked here since they're
  // point-in-time, not identity fields worth persisting.
  if (parsed && parsed.mac) update.$set.mac = parsed.mac;
  if (parsed && parsed.fw) update.$set.fw_version = parsed.fw;

  await database.collection(COLLECTION).updateOne(
    { factory_id, device_id },
    update,
    { upsert: true }
  );
}

async function getDevices({ factory_id, page = 1, limit = 50 }) {
  const database = await connect();
  const filter = {};
  if (factory_id) filter.factory_id = factory_id;

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