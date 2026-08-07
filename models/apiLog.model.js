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
  console.log('[global] api_logs collection ready');
  return db;
}

async function insertLog(logEntry) {
  const database = await connect();
  await database.collection(COLLECTION).insertOne(logEntry);
}

module.exports = { connect, insertLog };
