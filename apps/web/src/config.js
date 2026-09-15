import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

dotenv.config({ path: path.resolve(__dirname, '../../../.env') });
dotenv.config();

export const config = {
  env: process.env.NODE_ENV || 'development',
  port: Number(process.env.WEB_PORT || 3000),
  sessionSecret: process.env.SESSION_SECRET || 'service-desk-v3-local-secret',
  organizationServiceUrl: process.env.ORG_SERVICE_URL || 'http://localhost:4101',
  identityServiceUrl: process.env.IDENTITY_SERVICE_URL || 'http://localhost:4102',
  requestServiceUrl: process.env.REQUEST_SERVICE_URL || 'http://localhost:4103',
  cloudinary: {
    cloudName: process.env.CLOUDINARY_CLOUD_NAME || '',
    apiKey: process.env.CLOUDINARY_API_KEY || '',
    apiSecret: process.env.CLOUDINARY_API_SECRET || '',
    folder: process.env.CLOUDINARY_FOLDER || 'service-desk',
    maxUploadMb: Number(process.env.MAX_UPLOAD_MB || 10)
  },
  mail: {
    mode: String(process.env.MAIL_MODE || (process.env.OFFICE_365_EMAIL && process.env.OFFICE_365_PASSWORD ? 'smtp' : 'console')).trim().toLowerCase(),
    redirectTo: process.env.MAIL_REDIRECT_TO || 'karthikvj@suntecgroup.com',
    fromName: process.env.MAIL_FROM_NAME || 'Service Desk',
    office365Email: process.env.OFFICE_365_EMAIL || '',
    office365Password: process.env.OFFICE_365_PASSWORD || '',
    smtpHost: process.env.SMTP_HOST || 'smtp.office365.com',
    smtpPort: Number(process.env.SMTP_PORT || 587),
    smtpFrom: process.env.SMTP_FROM || process.env.OFFICE_365_EMAIL || 'service-desk@suntecgroup.com',
    smtpFamily: Number(process.env.SMTP_FAMILY || 4),
    connectionTimeoutMs: Number(process.env.SMTP_CONNECTION_TIMEOUT_MS || 5000),
    greetingTimeoutMs: Number(process.env.SMTP_GREETING_TIMEOUT_MS || 5000),
    socketTimeoutMs: Number(process.env.SMTP_SOCKET_TIMEOUT_MS || 10000),
    retryAttempts: Math.max(1, Number(process.env.MAIL_RETRY_ATTEMPTS || 2)),
    retryDelayMs: Math.max(0, Number(process.env.MAIL_RETRY_DELAY_MS || 750)),
    publicBaseUrl: String(process.env.PUBLIC_BASE_URL || '').trim().replace(/\/+$/, '')
  }
};
