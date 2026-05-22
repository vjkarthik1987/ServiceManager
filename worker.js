
require('dotenv').config();
const { connectDb } = require('./src/config/db');
const { startQueueWorker } = require('./src/modules/queue/queue.service');
const { startSlaWorker } = require('./src/modules/sla/sla.jobs');

async function start() {
  await connectDb();
  startQueueWorker();
  startSlaWorker();
  console.log('Service Desk v37.0.0 worker running');
}

start().catch((error) => {
  console.error('Failed to start Service Desk v37.0.0 worker:', error);
  process.exit(1);
});
