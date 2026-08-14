require('dotenv').config();

const express = require('express');
const cors = require('cors');
const swaggerUi = require('swagger-ui-express');
const YAML = require('yamljs');
const path = require('path');

const stagedModel = require('./models/staged.model');
const globalRoutes = require('./routes/global.routes');
const apiLogger = require('./middleware/apiLogger');

const app = express();

app.use(cors());
app.use(express.json({ limit: '10mb' })); // Line Setup / OB pushes can be large
app.use(apiLogger); // logs every request/response to MongoDB, Asia/Kolkata timestamps
app.use(express.static('public')); // simple admin UI — served at /

// Swagger UI at /docs
const swaggerDocument = YAML.load(path.join(__dirname, 'swagger.yaml'));
app.use('/docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument));
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument));

app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.use('/', globalRoutes);

// Basic error handler — asyncHandler in utils/response.js forwards
// thrown errors here via next(err)
app.use((err, req, res, next) => {
  console.error('[global] unhandled error:', err);
  res.status(500).json({ statusCode: 500, error: err.message || 'Internal server error' });
});

const PORT = process.env.NODE_PORT || 4000;

async function start() {
  await stagedModel.connect(); // fail fast if Mongo isn't reachable
  app.listen(PORT, () => {
    console.log(`[global] SuperManager Global Server listening on :${PORT}`);
    console.log(`[global] Swagger docs: http://localhost:${PORT}/docs`);
  });
}

start().catch((err) => {
  console.error('[global] failed to start:', err);
  process.exit(1);
});
