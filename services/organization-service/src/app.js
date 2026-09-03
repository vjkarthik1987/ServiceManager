import express from 'express';
import { config } from './config.js';
import { connectDatabase, disconnectDatabase } from './db.js';
import { requestContext } from './middleware/requestContext.js';
import { organizationRouter } from './routes/organizationRoutes.js';

const app = express();

app.use(express.json());
app.use(requestContext);

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'organization-service',
    timestamp: new Date().toISOString()
  });
});

app.use('/api/organizations', organizationRouter);

app.use((req, res) => {
  res.status(404).json({ message: 'Route not found.' });
});

app.use((error, req, res, next) => {
  console.error({
    requestId: req.context?.requestId,
    message: error.message,
    stack: config.env === 'development' ? error.stack : undefined
  });

  if (error.name === 'ValidationError') {
    return res.status(400).json({ message: Object.values(error.errors).map((item) => item.message).join(' ') });
  }

  if (error.code === 11000) {
    return res.status(409).json({ message: 'A record with this unique value already exists.' });
  }

  if (error.status) {
    return res.status(error.status).json({ message: error.message });
  }

  res.status(500).json({ message: 'Organization service error.' });
});

const server = app.listen(config.port, async () => {
  try {
    await connectDatabase();
    console.log(`Organization service running on http://localhost:${config.port}`);
  } catch (error) {
    console.error('Organization service failed to connect to MongoDB:', error.message);
    process.exitCode = 1;
    server.close();
  }
});

async function shutdown() {
  console.log('Organization service shutting down...');
  await disconnectDatabase();
  server.close(() => process.exit(0));
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
