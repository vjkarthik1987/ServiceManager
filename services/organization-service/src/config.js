import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

dotenv.config({ path: path.resolve(__dirname, '../../../.env') });
dotenv.config();

export const config = {
  env: process.env.NODE_ENV || 'development',
  port: Number(process.env.ORG_SERVICE_PORT || 4101),
  mongoUri: process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/service_desk_v8'
};
