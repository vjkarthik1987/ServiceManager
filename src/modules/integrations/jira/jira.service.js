const https = require('https');
const http = require('http');
const { URL } = require('url');
const { mapIssueToJiraPayload } = require('./jira.mapper');

const fs = require('fs');
const path = require('path');
const { resolveLocalAbsolutePath } = require('../../storage/storage.service');

function escapeMultipartName(value) {
  return String(value || '').replace(/"/g, '');
}

async function uploadJiraAttachment({ connection, issueIdOrKey, filePath, filename, mimeType = 'application/octet-stream' }) {
  if (isMockMode()) {
    return [{ id: `mock-attachment-${Date.now()}`, filename, mimeType }];
  }

  const absolutePath = path.isAbsolute(filePath) ? filePath : resolveLocalAbsolutePath(filePath);
  const fileBuffer = await fs.promises.readFile(absolutePath);
  const boundary = `----esop${Date.now().toString(16)}`;
  const preamble = Buffer.from(
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="file"; filename="${escapeMultipartName(filename)}"\r\n` +
    `Content-Type: ${mimeType || 'application/octet-stream'}\r\n\r\n`
  );
  const ending = Buffer.from(`\r\n--${boundary}--\r\n`);
  const payload = Buffer.concat([preamble, fileBuffer, ending]);
  const uploadPath = `/rest/api/3/issue/${encodeURIComponent(issueIdOrKey)}/attachments`;
  const url = new URL(`${normalizeBaseUrl(connection.baseUrl)}${uploadPath}`);
  const transport = url.protocol === 'http:' ? http : https;

  return new Promise((resolve, reject) => {
    const req = transport.request({
      protocol: url.protocol,
      hostname: url.hostname,
      port: url.port || (url.protocol === 'http:' ? 80 : 443),
      path: `${url.pathname}${url.search}`,
      method: 'POST',
      headers: {
        Authorization: buildAuthHeader(connection.email, connection.apiToken),
        Accept: 'application/json',
        'X-Atlassian-Token': 'no-check',
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': payload.length
      }
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        let parsed = null;
        try { parsed = raw ? JSON.parse(raw) : null; } catch (error) { parsed = null; }
        if (res.statusCode >= 200 && res.statusCode < 300) return resolve(parsed || []);
        const message = parsed?.errorMessages?.join(', ') || parsed?.message || raw || `Jira attachment upload failed with ${res.statusCode}`;
        const err = new Error(message);
        err.statusCode = res.statusCode;
        err.response = { data: parsed, raw };
        return reject(err);
      });
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

function normalizeBaseUrl(baseUrl) {
  return String(baseUrl || '').trim().replace(/\/+$/, '');
}

function buildAuthHeader(email, apiToken) {
  return `Basic ${Buffer.from(`${email}:${apiToken}`).toString('base64')}`;
}

function jiraRequest({ baseUrl, method = 'GET', path = '/', email, apiToken, body = null }) {
  const url = new URL(`${normalizeBaseUrl(baseUrl)}${path}`);
  const transport = url.protocol === 'http:' ? http : https;
  const payload = body ? JSON.stringify(body) : null;

  return new Promise((resolve, reject) => {
    const req = transport.request(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port || (url.protocol === 'http:' ? 80 : 443),
        path: `${url.pathname}${url.search}`,
        method,
        headers: {
          Authorization: buildAuthHeader(email, apiToken),
          Accept: 'application/json',
          ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {})
        }
      },
      (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8');
          let parsed = null;
          try { parsed = raw ? JSON.parse(raw) : null; } catch (error) { parsed = null; }
          if (res.statusCode >= 200 && res.statusCode < 300) {
            return resolve({ statusCode: res.statusCode, data: parsed, raw });
          }
          const message = parsed?.errorMessages?.join(', ') || parsed?.message || raw || `Jira request failed with ${res.statusCode}`;
          const err = new Error(message);
          err.statusCode = res.statusCode;
          err.response = { data: parsed, raw };
          return reject(err);
        });
      }
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function isMockMode() {
  const flag = String(process.env.JIRA_MOCK_MODE || '').trim().toLowerCase() === 'true';
  const allowOutsideTest = String(process.env.ALLOW_JIRA_MOCK_OUTSIDE_TEST || '').trim().toLowerCase() === 'true';
  const nodeEnv = String(process.env.NODE_ENV || '').trim().toLowerCase();
  if (!flag) return false;
  return nodeEnv === 'test' || allowOutsideTest;
}

async function validateJiraCredentials(connection) {
  if (isMockMode()) {
    return {
      ok: true,
      message: `Mock validation succeeded for ${connection.baseUrl}. No DNS or network call was attempted.`,
      myself: { accountId: 'mock-user', emailAddress: connection.email }
    };
  }

  const myself = await jiraRequest({
    baseUrl: connection.baseUrl,
    method: 'GET',
    path: '/rest/api/3/myself',
    email: connection.email,
    apiToken: connection.apiToken
  });

  return {
    ok: true,
    message: 'Credentials validated successfully.',
    myself: myself.data
  };
}

async function findExistingJiraIssueByEsopIssue({ connection, issue }) {
  if (isMockMode()) return null;
  const esopKey = String(issue.issueNumber || '').trim();
  if (!esopKey) return null;
  const jql = `summary ~ "\"${esopKey}\"" OR description ~ "\"${esopKey}\""`;
  const response = await jiraRequest({
    baseUrl: connection.baseUrl,
    method: 'POST',
    path: '/rest/api/3/search/jql',
    email: connection.email,
    apiToken: connection.apiToken,
    body: { jql, maxResults: 2, fields: ['summary', 'status'] }
  });
  const found = response.data?.issues?.[0];
  if (!found) return null;
  return {
    id: String(found.id || ''),
    key: found.key,
    self: found.self || '',
    issueUrl: `${normalizeBaseUrl(connection.baseUrl)}/browse/${found.key}`,
    currentStatusName: found.fields?.status?.name || '',
    currentStatusCategory: found.fields?.status?.statusCategory?.key || '',
    existing: true
  };
}

async function createJiraIssue({ connection, issue, tenantName, entityName, projectKey, issueTypeId = '', issueTypeName = '', jiraFields = {}, metadataFields = [] }) {
  if (isMockMode()) {
    const numeric = String(issue.issueNumber || '1001').replace(/\D/g, '').slice(-4) || '101';
    return {
      id: `mock-${numeric}`,
      key: `${projectKey}-${numeric}`,
      self: `${normalizeBaseUrl(connection.baseUrl || 'https://mock-jira.local')}/rest/api/3/issue/${projectKey}-${numeric}` ,
      issueUrl: `${normalizeBaseUrl(connection.baseUrl || 'https://mock-jira.local')}/browse/${projectKey}-${numeric}`,
      currentStatusName: 'Created in Jira',
      currentStatusCategory: 'TO_DO',
      existing: false
    };
  }

  const existing = await findExistingJiraIssueByEsopIssue({ connection, issue }).catch(() => null);
  if (existing) return existing;

  const payload = mapIssueToJiraPayload({ issue, projectKey, tenantName, entityName, issueTypeId, issueTypeName, jiraFields, metadataFields });
  try {
    const response = await jiraRequest({
      baseUrl: connection.baseUrl,
      method: 'POST',
      path: '/rest/api/3/issue',
      email: connection.email,
      apiToken: connection.apiToken,
      body: payload
    });
    return { ...response.data, issueUrl: `${normalizeBaseUrl(connection.baseUrl)}/browse/${response.data.key}`, currentStatusName: 'Created in Jira', currentStatusCategory: 'TO_DO', existing: false };
  } catch (error) {
    const recovered = await findExistingJiraIssueByEsopIssue({ connection, issue }).catch(() => null);
    if (recovered) return recovered;
    throw error;
  }
}

module.exports = { normalizeBaseUrl, validateJiraCredentials, createJiraIssue, uploadJiraAttachment, jiraRequest, isMockMode, findExistingJiraIssueByEsopIssue };
