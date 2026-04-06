require('dotenv').config();

const fs = require('fs');
const http = require('http');
const https = require('https');

const { connectDb } = require('./src/config/db');
const { createApp } = require('./src/app');
const { startQueueWorker } = require('./src/modules/queue/queue.service');
const { startSlaWorker } = require('./src/modules/sla/sla.jobs');

function createHttpServer(app) {
  const useHttps = String(process.env.USE_HTTPS || 'false') === 'true';

  if (!useHttps) {
    return {
      server: http.createServer(app),
      protocol: 'http'
    };
  }

  const keyPath = process.env.SSL_KEY_PATH;
  const certPath = process.env.SSL_CERT_PATH;

  if (!keyPath || !certPath) {
    throw new Error('USE_HTTPS=true requires SSL_KEY_PATH and SSL_CERT_PATH.');
  }

  return {
    server: https.createServer(
      {
        key: fs.readFileSync(keyPath),
        cert: fs.readFileSync(certPath)
      },
      app
    ),
    protocol: 'https'
  };
}

async function start() {
  const port = Number(process.env.PORT || 3000);
  const shouldStartEmbeddedWorkers =
    String(process.env.START_EMBEDDED_WORKERS || 'false') === 'true';

  console.log('Starting ESOP v30.8.8...');
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
    console.log(`ESOP v30.8.8 listening on ${protocol} port ${port}`);
  });
}

start().catch((error) => {
  console.error('Failed to start ESOP v30.8.8:', error);
  process.exit(1);
});