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

  client.subscribe(`LG/${process.env.NODE_ENV}/+`);
  client.subscribe(`Local_To_Global_Apis/production/+`);

  client.on('message', (topic, payload) => {
    console.log(`[global] received on ${topic}: ${payload.toString()}`);
  });

  return client;
}

// "New data is waiting" — notification only, no payload data. The Local
// server reacts by calling GET /global/pull itself.
async function pingFactory(factory_id) {
  const c = connect();
  const topic = process.env.NODE_ENV == "production" ? `GL/production/${factory_id}` : `GL/${factory_id}`;
  c.publish(topic, JSON.stringify({ type: 'pull_ready', factory_id, ts: Date.now() }));
}

// Triggers the Flovation container OTA update on a factory's local
// machine — the flovation-mqtt-listener systemd service subscribes to
// exactly this topic and, on { event: "update apis" }, runs
// flovation.sh: stop -> remove -> pull latest image -> run.
async function triggerFactoryUpdate(factory_id) {
  const c = connect();
  const topic = `Global_To_Local_Apis/production/${factory_id}`;
  c.publish(topic, JSON.stringify({ event: 'update apis', factoryId: factory_id, ts: Date.now() }));
}

// Triggers an OTA firmware update on ONE SPECIFIC DEVICE on a factory's
// floor. Deliberately a SEPARATE topic from triggerFactoryUpdate() above
// — that one restarts the Local server's own Docker container (handled
// by a bash systemd listener); this one relays a command through the
// Local server's Node.js app (globalMqttClient.js) to a specific ESP32
// device over ITS OWN local MQTT broker. Different concerns, different
// topics, different listeners — kept apart on purpose.
//
// otaFile should be a publicly reachable HTTPS URL — the device
// downloads directly from it via its existing startOTA() firmware code
// (unchanged), the same way it already does for locally-hosted OTA
// files today. No firmware changes needed.
async function triggerDeviceOta(factory_id, device_id, otaFile) {
  const c = connect();
  const topic = `Global_To_Local_Device_Ota/production/${factory_id}`;
  c.publish(topic, JSON.stringify({ event: 'device_ota', deviceId: device_id, otaFile, ts: Date.now() }));
}

module.exports = { connect, pingFactory, triggerFactoryUpdate, triggerDeviceOta };