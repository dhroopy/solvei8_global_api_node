const mqtt = require('mqtt');

// Separate broker/credentials from the Local server's device MQTT — this
// is purely Global <-> Local server communication, per your
// GLOBAL_MQTT_CREDS .env entry.
let client;

function connect() {
  if (client) return client;
  client = mqtt.connect({
    host: process.env.GLOBAL_MQTT_HOST,
    port: Number(process.env.GLOBAL_MQTT_PORT),
    username: process.env.GLOBAL_MQTT_USER,
    password: process.env.GLOBAL_MQTT_PASS,
    reconnectPeriod: 5000,
  });
  client.on('connect', () => console.log('[global] Global MQTT connected'));
  client.on('error', (err) => console.error('[global] Global MQTT error', err.message));

  // Local servers can publish on LG/{factory_id} if you want a
  // lightweight "I'm alive" or explicit ack-via-MQTT signal in future —
  // subscribing here now so the wiring exists even though the current
  // design does acks over HTTP, not MQTT.
  client.subscribe(process.env.NODE_ENV == "production" ? `LG/production/+` : `LG/+`);
  client.on('message', (topic, payload) => {
    console.log(`[global] received on ${topic}: ${payload.toString()}`);
  });

  return client;
}

// "New data is waiting" — notification only, no payload data. The Local
// server reacts by calling GET /global/pull itself; this message is
// deliberately minimal.
async function pingFactory(factory_id) {
  const c = connect();
  const topic = process.env.NODE_ENV == "production" ? `GL/production/${factory_id}` : `GL/${factory_id}`;
  c.publish(topic, JSON.stringify({ type: 'pull_ready', factory_id, ts: Date.now() }));
}

module.exports = { connect, pingFactory };
