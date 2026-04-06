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
    return { server: http.createServer(app), protocol: 'http' };
  }
  const keyPath = process.env.SSL_KEY_PATH;
  const certPath = process.env.SSL_CERT_PATH;
  if (!keyPath || !certPath) {
    throw new Error('USE_HTTPS=true requires SSL_KEY_PATH and SSL_CERT_PATH.');
  }
  return {
    server: https.createServer({ key: fs.readFileSync(keyPath), cert: fs.readFileSync(certPath) }, app),
    protocol: 'https'
  };
}

async function start() {
  await connectDb();
  const app = createApp();
  const port = process.env.PORT || 3000;

  if (String(process.env.START_EMBEDDED_WORKERS || 'false') === 'true' || process.env.NODE_ENV === 'test') {
    startQueueWorker();
    startSlaWorker();
  }

  const { server, protocol } = createHttpServer(app);
  server.listen(port, () => {
    console.log(`ESOP v30.8.8 running at ${protocol}://localhost:${port}`);
  });
}

start().catch((error) => {
  console.error('Failed to start ESOP v30.8.8:', error);
  process.exit(1);
});
