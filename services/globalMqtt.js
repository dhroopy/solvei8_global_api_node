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
  client.subscribe(`LG/${process.env.NODE_ENV}/+`);

  // The flovation-mqtt-listener systemd service (from localServerSetup.sh
  // / prodServerSetup.sh) reports its own connect/disconnect status here.
  client.subscribe(`Local_To_Global_Apis/production/+`);

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

// Triggers the Flovation OTA update on a specific factory's local
// machine — the flovation-mqtt-listener systemd service (see
// localServerSetup.sh / prodServerSetup.sh) subscribes to exactly this
// topic and, on receiving { event: "update apis" }, runs flovation.sh:
// stop -> remove -> pull latest image -> run. This is a real,
// consequential remote action (it restarts the factory's local API
// container), not a notification like pingFactory() above.
async function triggerFactoryUpdate(factory_id) {
  const c = connect();
  const topic = `Global_To_Local_Apis/${process.env.NODE_ENV}/${factory_id}`;
  c.publish(topic, JSON.stringify({ event: 'update apis', factoryId: factory_id, ts: Date.now() }));
}

module.exports = { connect, pingFactory, triggerFactoryUpdate };
