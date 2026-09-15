import express from 'express';
import { config } from './config.js';
import { connectDatabase, disconnectDatabase } from './db.js';
import { requestContext } from './middleware/requestContext.js';
import { adminRouter } from './routes/adminRoutes.js';
import { userRouter } from './routes/userRoutes.js';
import { authRouter } from './routes/authRoutes.js';

const app = express();

app.use(express.json());
app.use(requestContext);

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'identity-service',
    timestamp: new Date().toISOString()
  });
});

app.use('/api/admins', adminRouter);
app.use('/api/users', userRouter);
app.use('/api/auth', authRouter);

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
    return res.status(409).json({ message: 'A user with this email already exists for this organization.' });
  }

  if (error.status) {
    return res.status(error.status).json({ message: error.message });
  }

  res.status(500).json({ message: 'Identity service error.' });
});

const server = app.listen(config.port, async () => {
  try {
    await connectDatabase();
    console.log(`Identity service running on http://localhost:${config.port}`);
  } catch (error) {
    console.error('Identity service failed to connect to MongoDB:', error.message);
    process.exitCode = 1;
    server.close();
  }
});

async function shutdown() {
  console.log('Identity service shutting down...');
  await disconnectDatabase();
  server.close(() => process.exit(0));
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
