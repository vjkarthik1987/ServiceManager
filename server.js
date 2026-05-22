require('dotenv').config();

const fs = require('fs');
const http = require('http');
const https = require('https');

const { connectDb } = require('./src/config/db');
const { createApp } = require('./src/app');
const { startQueueWorker } = require('./src/modules/queue/queue.service');
const { startSlaWorker } = require('./src/modules/sla/sla.jobs');

function resolveSslPath(value, label) {
  if (!value) {
    throw new Error(`${label} is required when USE_HTTPS=true.`);
  }

  const resolvedPath = require('path').isAbsolute(value)
    ? value
    : require('path').join(__dirname, value);

  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`${label} does not exist: ${resolvedPath}`);
  }

  return resolvedPath;
}

function createHttpServer(app) {
  const useHttps = String(process.env.USE_HTTPS || 'false') === 'true';

  if (!useHttps) {
    return {
      server: http.createServer(app),
      protocol: 'http'
    };
  }

  const keyPath = resolveSslPath(process.env.SSL_KEY_PATH, 'SSL_KEY_PATH');
  const certPath = resolveSslPath(process.env.SSL_CERT_PATH, 'SSL_CERT_PATH');
  const caPath = process.env.SSL_CA_PATH ? resolveSslPath(process.env.SSL_CA_PATH, 'SSL_CA_PATH') : null;

  const tlsOptions = {
    key: fs.readFileSync(keyPath),
    cert: fs.readFileSync(certPath)
  };

  if (caPath) {
    tlsOptions.ca = fs.readFileSync(caPath);
  }

  return {
    server: https.createServer(tlsOptions, app),
    protocol: 'https'
  };
}

async function start() {
  const port = Number(process.env.PORT || 3000);
  const shouldStartEmbeddedWorkers =
    String(process.env.START_EMBEDDED_WORKERS || 'false') === 'true';

  console.log('Starting Service Desk v37.0.0...');
  console.log('NODE_ENV:', process.env.NODE_ENV || 'development');
  console.log('PORT:', port);
  console.log('USE_HTTPS:', String(process.env.USE_HTTPS || 'false'));
  console.log('TRUST_PROXY:', String(process.env.TRUST_PROXY || 'false'));
  console.log('MONGODB_URI present:', Boolean(process.env.MONGODB_URI));
  console.log('START_EMBEDDED_WORKERS:', shouldStartEmbeddedWorkers);

  await connectDb();

  const app = createApp();

  if (shouldStartEmbeddedWorkers || process.env.NODE_ENV === 'test') {
    console.log('Starting embedded workers...');
    startQueueWorker();
    startSlaWorker();
  } else {
    console.log('Embedded workers are disabled for this process.');
  }

  const { server, protocol } = createHttpServer(app);

  server.listen(port, '0.0.0.0', () => {
    console.log(`Service Desk v37.0.0 listening on ${protocol} port ${port}`);
  });
}

start().catch((error) => {
  console.error('Failed to start Service Desk v37.0.0:', error);
  process.exit(1);
});