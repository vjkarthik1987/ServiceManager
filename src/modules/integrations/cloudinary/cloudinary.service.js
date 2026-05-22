const https = require('https');
const crypto = require('crypto');

function getConfig() {
  const cloudName = String(process.env.CLOUDINARY_CLOUD_NAME || '').trim();
  const apiKey = String(process.env.CLOUDINARY_API_KEY || '').trim();
  const apiSecret = String(process.env.CLOUDINARY_API_SECRET || '').trim();
  const rootFolder = String(process.env.CLOUDINARY_ROOT_FOLDER || 'ServiceDesk')
    .replace(/^\/+|\/+$/g, '')
    .trim() || 'ServiceDesk';

  return {
    cloudName,
    apiKey,
    apiSecret,
    rootFolder,
    isConfigured: Boolean(cloudName && apiKey && apiSecret)
  };
}

function assertConfigured() {
  const config = getConfig();
  if (!config.isConfigured) {
    const error = new Error('Cloudinary storage is not configured. Set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET.');
    error.status = 500;
    throw error;
  }
  return config;
}

function sanitizeCloudinarySegment(value, fallback = 'unknown') {
  const cleaned = String(value || fallback)
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 120);
  return cleaned || fallback;
}

function buildSignature(params, apiSecret) {
  const payload = Object.keys(params)
    .filter((key) => params[key] !== undefined && params[key] !== null && params[key] !== '')
    .sort()
    .map((key) => `${key}=${params[key]}`)
    .join('&');

  return crypto.createHash('sha1').update(`${payload}${apiSecret}`).digest('hex');
}

function appendField(parts, boundary, name, value) {
  parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${String(value)}\r\n`));
}

function appendFile(parts, boundary, name, file) {
  const filename = String(file.filename || 'file');
  const mimeType = String(file.mimeType || 'application/octet-stream');
  parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"; filename="${filename}"\r\nContent-Type: ${mimeType}\r\n\r\n`));
  parts.push(Buffer.isBuffer(file.buffer) ? file.buffer : Buffer.from(file.buffer || ''));
  parts.push(Buffer.from('\r\n'));
}

function requestMultipart({ hostname, path, fields, file }) {
  return new Promise((resolve, reject) => {
    const boundary = `----ServiceDeskCloudinary${crypto.randomBytes(12).toString('hex')}`;
    const parts = [];

    Object.entries(fields || {}).forEach(([name, value]) => appendField(parts, boundary, name, value));
    appendFile(parts, boundary, 'file', file);
    parts.push(Buffer.from(`--${boundary}--\r\n`));

    const body = Buffer.concat(parts);

    const req = https.request({
      method: 'POST',
      hostname,
      path,
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': body.length
      }
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json = null;
        try { json = text ? JSON.parse(text) : null; } catch (_) {}
        if (res.statusCode >= 200 && res.statusCode < 300) {
          return resolve(json || {});
        }
        const error = new Error(`Cloudinary request failed with HTTP ${res.statusCode}: ${text.slice(0, 500)}`);
        error.status = res.statusCode;
        error.responseBody = text;
        reject(error);
      });
    });

    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function uploadFile({ buffer, filename, mimeType, folder, publicId = null, resourceType = 'auto' }) {
  const config = assertConfigured();
  const timestamp = Math.floor(Date.now() / 1000);
  const params = {
    timestamp,
    folder
  };

  if (publicId) params.public_id = publicId;

  const signature = buildSignature(params, config.apiSecret);
  const fields = {
    ...params,
    api_key: config.apiKey,
    signature
  };

  return requestMultipart({
    hostname: 'api.cloudinary.com',
    path: `/v1_1/${encodeURIComponent(config.cloudName)}/${encodeURIComponent(resourceType)}/upload`,
    fields,
    file: {
      filename,
      mimeType,
      buffer
    }
  });
}

function buildFolderPath({ tenantId, issueId }) {
  const config = getConfig();
  return [
    config.rootFolder,
    sanitizeCloudinarySegment(tenantId),
    sanitizeCloudinarySegment(issueId)
  ].filter(Boolean).join('/');
}

function getDownloadUrl(metadata) {
  return metadata?.storageSecureUrl || metadata?.storageWebUrl || metadata?.storagePath || '';
}

async function testCloudinaryConnection() {
  const config = assertConfigured();
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = buildSignature({ timestamp }, config.apiSecret);

  return new Promise((resolve, reject) => {
    const path = `/v1_1/${encodeURIComponent(config.cloudName)}/usage?timestamp=${timestamp}&api_key=${encodeURIComponent(config.apiKey)}&signature=${signature}`;
    const req = https.request({
      method: 'GET',
      hostname: 'api.cloudinary.com',
      path
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        if (res.statusCode >= 200 && res.statusCode < 300) {
          return resolve({
            ok: true,
            cloudName: config.cloudName,
            rootFolder: config.rootFolder
          });
        }
        const error = new Error(`Cloudinary connection test failed with HTTP ${res.statusCode}: ${text.slice(0, 500)}`);
        error.status = res.statusCode;
        reject(error);
      });
    });
    req.on('error', reject);
    req.end();
  });
}

module.exports = {
  getConfig,
  assertConfigured,
  uploadFile,
  buildFolderPath,
  testCloudinaryConnection,
  getDownloadUrl,
  sanitizeCloudinarySegment
};
