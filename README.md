# SuperManager Global Server

Receives SolveI8's Line Setup / Workstation / Operation / Tag Mapping
pushes (same request shapes as before, no change needed on SolveI8's
side), stages the raw data in MongoDB by `factory_id`, and serves it to
each factory's Local server via a pull-then-acknowledge sync — plus a
lightweight MQTT ping to wake a Local server up the moment new data
arrives for it.

## Setup

```bash
npm install
cp .env.example .env
# fill in your actual MongoDB URL and MQTT broker credentials
npm start
```

Swagger UI: `http://localhost:<NODE_PORT>/docs`

## How data flows

1. SolveI8 calls `POST /ext/api/v1/{operationBreakdown|lineSetup|tagMapping}`
   — exactly as before, no changes on their end.
2. Each factory in the payload gets staged as its own MongoDB document
   (`unique_id`, `factory_id`, `endpoint`, `data`, `last_sync`, `doa`).
3. A `GL/{factory_id}` MQTT message fires immediately, telling that
   factory's Local server new data is ready.
4. Local server calls `GET /global/pull?factory_id=X` (triggered by that
   MQTT ping, a 10-minute safety-net timer, or its own connection coming
   back up after being down) and gets back everything unsynced for it.
5. Local server processes it through its own existing logic, then calls
   `POST /global/ack` with the `unique_id`s it actually succeeded on.
   Only those get marked `last_sync` — anything not acknowledged stays
   unsynced and comes back on the next pull, so a Local server crash
   mid-processing never silently drops data.

## Project structure

```
server.js                    entry point
routes/global.routes.js      all 5 endpoints wired together
controllers/
  ingest.controller.js       the 3 SolveI8-facing endpoints
  sync.controller.js         pull + ack
models/staged.model.js       MongoDB access — insert/query/mark-synced
services/globalMqtt.js       fires the GL/{factory_id} ping
utils/response.js            small response-shape helpers
swagger.yaml                 OpenAPI spec served at /docs
```

## Notes

- No authentication is implemented on any endpoint here — add whatever
  matches your existing SuperManager API auth pattern before deploying
  this somewhere reachable from the internet.
- `MONGODB_URL` — use your existing MongoDB connection string.
- The `factories[]` request shape matches SolveI8's existing payloads
  exactly — each item in the array becomes one staged record.
