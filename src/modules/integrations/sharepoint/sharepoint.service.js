const https = require('https');
const { URL, URLSearchParams } = require('url');
const { PassThrough } = require('stream');

const GRAPH_HOST = 'graph.microsoft.com';
const GRAPH_SCOPE = 'https://graph.microsoft.com/.default';
const tokenCache = { accessToken: null, expiresAt: 0 };

function getConfig() {
  return {
    tenantId: process.env.MS_TENANT_ID || process.env.TENANT_ID || '',
    clientId: process.env.MS_CLIENT_ID || process.env.CLIENT_ID || '',
    clientSecret: process.env.MS_CLIENT_SECRET || process.env.CLIENT_SECRET || '',
    siteId: process.env.SHAREPOINT_SITE_ID || '',
    driveId: process.env.SHAREPOINT_DRIVE_ID || '',
    rootFolder: normalizeRootFolder(process.env.SHAREPOINT_ROOT_FOLDER || '/ServiceDesk')
  };
}

function normalizeRootFolder(value) {
  const cleaned = String(value || '/ServiceDesk').replace(/\\/g, '/').replace(/\/+/g, '/').replace(/^\/+|\/+$/g, '');
  return cleaned || 'ServiceDesk';
}

function assertConfigured() {
  const config = getConfig();
  const missing = [];
  if (!config.tenantId) missing.push('MS_TENANT_ID or TENANT_ID');
  if (!config.clientId) missing.push('MS_CLIENT_ID or CLIENT_ID');
  if (!config.clientSecret) missing.push('MS_CLIENT_SECRET or CLIENT_SECRET');
  if (!config.driveId) missing.push('SHAREPOINT_DRIVE_ID');
  if (missing.length) {
    const error = new Error(`SharePoint storage is not configured. Missing: ${missing.join(', ')}`);
    error.status = 500;
    throw error;
  }
  return config;
}

function requestBuffer({ method = 'GET', hostname = GRAPH_HOST, path, headers = {}, body = null }) {
  return new Promise((resolve, reject) => {
    const req = https.request({ method, hostname, path, headers }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const buffer = Buffer.concat(chunks);
        const text = buffer.toString('utf8');
        if (res.statusCode >= 200 && res.statusCode < 300) {
          const contentType = String(res.headers['content-type'] || '');
          if (contentType.includes('application/json') && text) {
            try { return resolve(JSON.parse(text)); } catch (error) { return reject(error); }
          }
          return resolve(buffer);
        }
        const error = new Error(`Microsoft Graph request failed with HTTP ${res.statusCode}: ${text.slice(0, 500)}`);
        error.status = res.statusCode;
        error.responseBody = text;
        return reject(error);
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

async function getAccessToken() {
  const config = assertConfigured();
  if (tokenCache.accessToken && tokenCache.expiresAt > Date.now() + 60_000) {
    return tokenCache.accessToken;
  }

  const form = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    scope: GRAPH_SCOPE,
    grant_type: 'client_credentials'
  }).toString();

  const token = await requestBuffer({
    method: 'POST',
    hostname: 'login.microsoftonline.com',
    path: `/${encodeURIComponent(config.tenantId)}/oauth2/v2.0/token`,
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Content-Length': Buffer.byteLength(form)
    },
    body: form
  });

  tokenCache.accessToken = token.access_token;
  tokenCache.expiresAt = Date.now() + (Number(token.expires_in || 3600) * 1000);
  return tokenCache.accessToken;
}

async function graphJson(path, { method = 'GET', body = null, extraHeaders = {} } = {}) {
  const accessToken = await getAccessToken();
  const payload = body ? JSON.stringify(body) : null;
  return requestBuffer({
    method,
    path,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
      ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}),
      ...extraHeaders
    },
    body: payload
  });
}

async function graphUpload(path, buffer, mimeType) {
  const accessToken = await getAccessToken();
  return requestBuffer({
    method: 'PUT',
    path,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': mimeType || 'application/octet-stream',
      'Content-Length': Buffer.byteLength(buffer || Buffer.alloc(0))
    },
    body: buffer || Buffer.alloc(0)
  });
}

function encodeDrivePath(pathValue) {
  return String(pathValue || '')
    .replace(/\\/g, '/')
    .split('/')
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

function driveRootPath(relativePath = '') {
  const config = assertConfigured();
  const encoded = encodeDrivePath(relativePath);
  return `/v1.0/drives/${encodeURIComponent(config.driveId)}/root:/${encoded}`;
}

async function getDriveItemByPath(relativePath) {
  try {
    return await graphJson(driveRootPath(relativePath));
  } catch (error) {
    if (error.status === 404) return null;
    throw error;
  }
}

async function ensureFolderPath(relativeFolderPath) {
  const config = assertConfigured();
  const segments = String(relativeFolderPath || '').replace(/\\/g, '/').split('/').filter(Boolean);
  let currentPath = '';
  let currentItem = null;

  for (const segment of segments) {
    const nextPath = currentPath ? `${currentPath}/${segment}` : segment;
    let existing = await getDriveItemByPath(nextPath);
    if (!existing) {
      const parentPath = currentPath
        ? `/v1.0/drives/${encodeURIComponent(config.driveId)}/root:/${encodeDrivePath(currentPath)}:/children`
        : `/v1.0/drives/${encodeURIComponent(config.driveId)}/root/children`;
      existing = await graphJson(parentPath, {
        method: 'POST',
        body: {
          name: segment,
          folder: {},
          '@microsoft.graph.conflictBehavior': 'fail'
        }
      });
    }
    currentPath = nextPath;
    currentItem = existing;
  }

  return currentItem;
}

async function uploadSmallFile({ relativePath, buffer, mimeType }) {
  const folderPath = String(relativePath || '').replace(/\\/g, '/').split('/').filter(Boolean).slice(0, -1).join('/');
  if (folderPath) await ensureFolderPath(folderPath);
  const uploadPath = `${driveRootPath(relativePath)}:/content`;
  return graphUpload(uploadPath, buffer || Buffer.alloc(0), mimeType || 'application/octet-stream');
}

function requestStreamFollowingRedirect(urlOrOptions, headers = {}, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    const options = typeof urlOrOptions === 'string' ? new URL(urlOrOptions) : urlOrOptions;
    const req = https.request({ ...options, method: 'GET', headers }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && redirectCount < 5) {
        res.resume();
        return resolve(requestStreamFollowingRedirect(res.headers.location, {}, redirectCount + 1));
      }
      if (res.statusCode >= 200 && res.statusCode < 300) return resolve(res);
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const error = new Error(`SharePoint download failed with HTTP ${res.statusCode}: ${Buffer.concat(chunks).toString('utf8').slice(0, 500)}`);
        error.status = res.statusCode;
        reject(error);
      });
    });
    req.on('error', reject);
    req.end();
  });
}

async function getDownloadStream({ itemId }) {
  const config = assertConfigured();
  const accessToken = await getAccessToken();
  return requestStreamFollowingRedirect({
    hostname: GRAPH_HOST,
    path: `/v1.0/drives/${encodeURIComponent(config.driveId)}/items/${encodeURIComponent(itemId)}/content`
  }, { Authorization: `Bearer ${accessToken}` });
}

async function testSharePointConnection() {
  const config = assertConfigured();
  const drive = await graphJson(`/v1.0/drives/${encodeURIComponent(config.driveId)}`);
  const root = await ensureFolderPath(config.rootFolder);
  return {
    ok: true,
    driveId: drive.id,
    driveName: drive.name,
    driveType: drive.driveType,
    rootFolder: config.rootFolder,
    rootFolderId: root?.id || null,
    webUrl: root?.webUrl || drive.webUrl || null
  };
}

module.exports = {
  getConfig,
  testSharePointConnection,
  ensureFolderPath,
  uploadSmallFile,
  getDownloadStream
};
