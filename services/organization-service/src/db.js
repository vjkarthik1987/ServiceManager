import mongoose from 'mongoose';
import { config } from './config.js';

export async function connectDatabase() {
  mongoose.set('strictQuery', true);

  await mongoose.connect(config.mongoUri, {
    serverSelectionTimeoutMS: 6000
  });

  console.log('Organization service connected to MongoDB');
}

export async function disconnectDatabase() {
  await mongoose.disconnect();
}
