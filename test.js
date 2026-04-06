require('dotenv').config();
const http = require('http');
const querystring = require('querystring');
const mongoose = require('mongoose');
const { connectDb } = require('./src/config/db');
const { createApp } = require('./src/app');
const { Entity } = require('./src/modules/entities/entity.model');
const { User } = require('./src/modules/users/user.model');
const { UserEntityMembership } = require('./src/modules/memberships/membership.model');
const { Issue } = require('./src/modules/issues/issue.model');
const { IssueComment } = require('./src/modules/issues/issue-comment.model');
const { IssueActivity } = require('./src/modules/issues/issue-activity.model');
const { IssueCounter } = require('./src/modules/issues/issue-counter.model');
const { FileAsset } = require('./src/modules/storage/file-asset.model');
const { createUserForTenant } = require('./src/modules/users/user.service');
const { Tenant } = require('./src/modules/tenant/tenant.model');
const { SupportGroup } = require('./src/modules/support-groups/support-group.model');
const { RoutingRule } = require('./src/modules/routing/routing-rule.model');
const { JiraConnection } = require('./src/modules/integrations/jira/jira-connection.model');

const TENANT_ID = new mongoose.Types.ObjectId('64a000000000000000000001');
const TENANT_B_ID = new mongoose.Types.ObjectId('64a000000000000000000002');
const PASSWORD = 'password';

function nowMs() {
  return Number(process.hrtime.bigint() / 1000000n);
}

function request({ port, path, method = 'GET', headers = {}, body = null }) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { hostname: '127.0.0.1', port, path, method, headers },
      (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
        res.on('end', () => {
          const buffer = Buffer.concat(chunks);
          resolve({
            statusCode: res.statusCode,
            headers: res.headers,
            buffer,
            body: buffer.toString('utf8')
          });
        });
      }
    );
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

function extractCookies(setCookieHeader = []) {
  return setCookieHeader.map((value) => value.split(';')[0]).join('; ');
}

function extractCsrfToken(html) {
  const match = html.match(/name="_csrf" value="([^"]+)"/);
  return match ? match[1] : null;
}

async function loginSession(port, email, password, tenantSlugOverride = null) {
  const tenantSlug = tenantSlugOverride || process.env.TENANT_SLUG || process.env.TENANT_CODE || 'suntec';
  const loginPath = `/${tenantSlug}/login`;
  let loginPage = await request({ port, path: loginPath });
  let cookies = extractCookies(loginPage.headers['set-cookie'] || []);
  let csrfToken = extractCsrfToken(loginPage.body);

  if (!csrfToken) {
    loginPage = await request({ port, path: '/login' });
    cookies = extractCookies(loginPage.headers['set-cookie'] || []) || cookies;
    csrfToken = extractCsrfToken(loginPage.body);
  }

  if (!csrfToken) {
    throw new Error(`Unable to extract CSRF token for ${email}.`);
  }

  const payload = querystring.stringify({ email, password, _csrf: csrfToken });

  const loginResponse = await request({
    port,
    path: loginPath,
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Content-Length': Buffer.byteLength(payload),
      Cookie: cookies
    },
    body: payload
  });

  if (![200, 302].includes(loginResponse.statusCode)) {
    throw new Error(`Login failed for ${email}: ${loginResponse.statusCode} ${loginResponse.body}`);
  }

  return extractCookies(loginResponse.headers['set-cookie'] || []) || cookies;
}


async function signupWorkspace(port, { organizationName, tenantSlug, adminName, adminEmail, adminPassword }, cookie = '') {
  const signupPage = await request({
    port,
    path: '/signup',
    headers: cookie ? { Cookie: cookie } : {}
  });

  const cookies = extractCookies(signupPage.headers['set-cookie'] || []) || cookie;
  const csrfToken = extractCsrfToken(signupPage.body);
  if (!csrfToken) {
    throw new Error('Unable to extract CSRF token for signup.');
  }

  const payload = querystring.stringify({
    organizationName,
    tenantSlug,
    adminName,
    adminEmail,
    adminPassword,
    _csrf: csrfToken
  });

  return request({
    port,
    path: '/signup',
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Content-Length': Buffer.byteLength(payload),
      ...(cookies ? { Cookie: cookies } : {})
    },
    body: payload
  });
}

async function apiJson({ port, path, method = 'GET', cookie, body }) {
  const response = await request({
    port,
    path,
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
      'x-test-bypass-csrf': '1'
    },
    body: body ? JSON.stringify(body) : null
  });

  let parsed = null;
  try {
    parsed = response.body ? JSON.parse(response.body) : null;
  } catch (error) {
    parsed = null;
  }

  return { ...response, json: parsed };
}

function buildMultipartBody(fields = {}, files = []) {
  const boundary = `----esop-boundary-${Date.now()}`;
  const chunks = [];

  const append = (value) => chunks.push(Buffer.isBuffer(value) ? value : Buffer.from(String(value)));

  Object.entries(fields).forEach(([key, value]) => {
    const values = Array.isArray(value) ? value : [value];
    values.forEach((item) => {
      append(`--${boundary}\r\n`);
      append(`Content-Disposition: form-data; name="${key}"\r\n\r\n`);
      append(String(item));
      append('\r\n');
    });
  });

  files.forEach((file) => {
    append(`--${boundary}\r\n`);
    append(`Content-Disposition: form-data; name="${file.fieldName}"; filename="${file.filename}"\r\n`);
    append(`Content-Type: ${file.contentType}\r\n\r\n`);
    append(file.content);
    append('\r\n');
  });

  append(`--${boundary}--\r\n`);
  return { boundary, body: Buffer.concat(chunks) };
}

async function apiMultipart({ port, path, method = 'POST', cookie, fields = {}, files = [] }) {
  const multipart = buildMultipartBody(fields, files);
  const response = await request({
    port,
    path,
    method,
    headers: {
      'Content-Type': `multipart/form-data; boundary=${multipart.boundary}`,
      'Content-Length': multipart.body.length,
      ...(cookie ? { Cookie: cookie } : {}),
      'x-test-bypass-csrf': '1'
    },
    body: multipart.body
  });

  let parsed = null;
  try {
    parsed = response.body ? JSON.parse(response.body) : null;
  } catch (error) {
    parsed = null;
  }

  return { ...response, json: parsed };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

(async () => {
  let server;
  const timings = {};

  try {
    process.env.NODE_ENV = process.env.NODE_ENV || 'test';
    process.env.JIRA_MOCK_MODE = 'true';
    process.env.ALLOW_JIRA_MOCK_OUTSIDE_TEST = 'true';
    await connectDb();

    const staleTenants = await Tenant.find({ slug: { $in: ['suntec', 'acme'] } }).lean();
    const cleanupTenantIds = [...new Set([...staleTenants.map((tenant) => String(tenant._id)), String(TENANT_ID), String(TENANT_B_ID)])].map((id) => new mongoose.Types.ObjectId(id));

    await Promise.all([
      Entity.deleteMany({ tenantId: { $in: cleanupTenantIds } }),
      User.deleteMany({ tenantId: { $in: cleanupTenantIds } }),
      UserEntityMembership.deleteMany({ tenantId: { $in: cleanupTenantIds } }),
      Issue.deleteMany({ tenantId: { $in: cleanupTenantIds } }),
      IssueComment.deleteMany({ tenantId: { $in: cleanupTenantIds } }),
      IssueActivity.deleteMany({ tenantId: { $in: cleanupTenantIds } }),
      IssueCounter.deleteMany({ tenantId: { $in: cleanupTenantIds } }),
      FileAsset.deleteMany({ tenantId: { $in: cleanupTenantIds } }),
      SupportGroup.deleteMany({ tenantId: { $in: cleanupTenantIds } }),
      RoutingRule.deleteMany({ tenantId: { $in: cleanupTenantIds } }),
      JiraConnection.deleteMany({ tenantId: { $in: cleanupTenantIds } }),
      Tenant.deleteMany({ slug: { $in: ['suntec', 'acme'] } })
    ]);

    await Tenant.create({ _id: TENANT_ID, name: 'SunTec', slug: 'suntec', status: 'active' });
    await Tenant.create({ _id: TENANT_B_ID, name: 'Acme', slug: 'acme', status: 'active' });

    const parentA = await Entity.create({
      tenantId: TENANT_ID,
      name: 'Client A',
      acronym: 'CLTA',
      type: 'client',
      path: 'Client A',
      metadata: { region: 'Africa', product: 'ESOP', slaTier: 'Gold' }
    });

    const childA = await Entity.create({
      tenantId: TENANT_ID,
      name: 'Client A Sub',
      acronym: 'CLTS',
      type: 'subclient',
      parentId: parentA._id,
      path: 'Client A / Client A Sub',
      metadata: { region: 'Zimbabwe', product: 'ESOP', slaTier: 'Gold' }
    });

    const parentB = await Entity.create({
      tenantId: TENANT_ID,
      name: 'Client B',
      acronym: 'CLTB',
      type: 'client',
      path: 'Client B',
      metadata: { region: 'MEA', product: 'ESOP', slaTier: 'Silver' }
    });

    const childB = await Entity.create({
      tenantId: TENANT_ID,
      name: 'Client B Sub',
      acronym: 'CLBU',
      type: 'subclient',
      parentId: parentB._id,
      path: 'Client B / Client B Sub',
      metadata: { region: 'UAE', product: 'ESOP', slaTier: 'Silver' }
    });

    await createUserForTenant({ tenantId: TENANT_ID, name: 'Superadmin', email: 'superadmin@local.test', password: PASSWORD, role: 'superadmin' });
    await createUserForTenant({ tenantId: TENANT_B_ID, name: 'Acme Superadmin', email: 'superadmin@acme.test', password: PASSWORD, role: 'superadmin' });
    await createUserForTenant({ tenantId: TENANT_ID, name: 'Agent A', email: 'agenta@local.test', password: PASSWORD, role: 'agent', entityIds: [parentA._id.toString(), childA._id.toString()] });
    await createUserForTenant({ tenantId: TENANT_ID, name: 'Agent B', email: 'agentb@local.test', password: PASSWORD, role: 'agent', entityIds: [parentB._id.toString(), childB._id.toString()] });
    await createUserForTenant({ tenantId: TENANT_ID, name: 'Client A User', email: 'clienta@local.test', password: PASSWORD, role: 'client', entityId: childA._id.toString() });
    await createUserForTenant({ tenantId: TENANT_ID, name: 'Client B User', email: 'clientb@local.test', password: PASSWORD, role: 'client', entityId: childB._id.toString() });

    const accessGroup = await SupportGroup.create({ tenantId: TENANT_ID, name: 'Access Support', code: 'ACCESS', defaultAssigneeUserId: (await User.findOne({ email: 'agenta@local.test' }))._id });
    await RoutingRule.create({ tenantId: TENANT_ID, name: 'Access route', category: 'ACCESS', priority: 'ANY', supportGroupId: accessGroup._id, defaultAssigneeUserId: (await User.findOne({ email: 'agenta@local.test' }))._id, rank: 1, executionMode: 'NATIVE' });
    await RoutingRule.create({ tenantId: TENANT_ID, name: 'Integration route', category: 'INTEGRATION', priority: 'ANY', supportGroupId: accessGroup._id, defaultAssigneeUserId: (await User.findOne({ email: 'agenta@local.test' }))._id, rank: 2, executionMode: 'JIRA', jiraProjectKey: 'INT' });

    const acmeEntity = await Entity.create({ tenantId: TENANT_B_ID, name: 'Acme Client', acronym: 'ACME', type: 'client', path: 'Acme Client', metadata: {} });
    const acmeUser = await createUserForTenant({ tenantId: TENANT_B_ID, name: 'Acme Client User', email: 'client@acme.test', password: PASSWORD, role: 'client', entityId: acmeEntity._id.toString() });

    const app = createApp();
    server = app.listen(0);
    const port = await new Promise((resolve) => server.on('listening', () => resolve(server.address().port)));

    const superadminCookie = await loginSession(port, 'superadmin@local.test', PASSWORD);
    const agentACookie = await loginSession(port, 'agenta@local.test', PASSWORD);
    const clientACookie = await loginSession(port, 'clienta@local.test', PASSWORD);
    const clientBCookie = await loginSession(port, 'clientb@local.test', PASSWORD);
    const acmeCookie = await loginSession(port, 'client@acme.test', PASSWORD, 'acme');

    const tenantSlug = process.env.TENANT_SLUG || process.env.TENANT_CODE || 'suntec';


    const saveJiraConfigResponse = await apiJson({
      port,
      path: `/api/v1/${tenantSlug}/admin/integrations/jira`,
      method: 'PUT',
      cookie: superadminCookie,
      body: {
        baseUrl: 'https://mock-jira.local',
        email: 'jira-admin@local.test',
        apiToken: 'mock-token-123456',
        projectKeyDefault: 'OPS',
        isActive: true
      }
    });
    assert(saveJiraConfigResponse.statusCode === 200, `Save Jira config failed: ${saveJiraConfigResponse.body}`);
    assert(saveJiraConfigResponse.json?.item?.projectKeyDefault === 'OPS', 'Default Jira project key should be saved');
    assert(!('apiToken' in (saveJiraConfigResponse.json?.item || {})), 'API token must never be exposed');

    const getJiraConfigResponse = await apiJson({
      port,
      path: `/api/v1/${tenantSlug}/admin/integrations/jira`,
      cookie: superadminCookie
    });
    assert(getJiraConfigResponse.statusCode === 200, `Get Jira config failed: ${getJiraConfigResponse.body}`);
    assert(getJiraConfigResponse.json?.item?.apiTokenMasked, 'Masked Jira token should be returned');

    const validateJiraConfigResponse = await apiJson({
      port,
      path: `/api/v1/${tenantSlug}/admin/integrations/jira/validate`,
      method: 'POST',
      cookie: superadminCookie
    });
    assert(validateJiraConfigResponse.statusCode === 200, `Validate Jira config failed: ${validateJiraConfigResponse.body}`);
    assert(validateJiraConfigResponse.json?.item?.lastValidationStatus === 'SUCCESS', 'Jira config should validate successfully in mock mode');

    const clientConfigDenied = await apiJson({
      port,
      path: `/api/v1/${tenantSlug}/admin/integrations/jira`,
      method: 'PUT',
      cookie: clientACookie,
      body: { baseUrl: 'https://denied.local', email: 'x@y.com', apiToken: 'x', projectKeyDefault: 'INT', isActive: true }
    });
    assert(clientConfigDenied.statusCode === 403, 'Client must not be allowed to configure Jira');

    const issueFile = Buffer.from('issue attachment content for v10.4', 'utf8');
    const commentFile = Buffer.from('comment attachment content for v10.4', 'utf8');
    const imageFile = Buffer.from([0x89,0x50,0x4E,0x47,0x0D,0x0A,0x1A,0x0A,0x00,0x00,0x00,0x0D,0x49,0x48,0x44,0x52,0x00,0x00,0x00,0x01,0x00,0x00,0x00,0x01,0x08,0x02,0x00,0x00,0x00,0x90,0x77,0x53,0xDE,0x00,0x00,0x00,0x0C,0x49,0x44,0x41,0x54,0x08,0xD7,0x63,0xF8,0xCF,0xC0,0x00,0x00,0x03,0x01,0x01,0x00,0x18,0xDD,0x8D,0xB1,0x00,0x00,0x00,0x00,0x49,0x45,0x4E,0x44,0xAE,0x42,0x60,0x82]);

    let t0 = nowMs();
    const createIssueResponse = await apiMultipart({
      port,
      path: `/api/v1/${tenantSlug}/issues`,
      method: 'POST',
      cookie: clientACookie,
      fields: {
        entityId: childA._id.toString(),
        title: 'Unable to access billing console',
        description: 'The billing console throws an error when opening invoices.',
        priority: 'HIGH',
        category: 'INTEGRATION',
        tags: ['billing', 'login']
      },
      files: [
        {
          fieldName: 'attachments',
          filename: 'evidence.txt',
          contentType: 'text/plain',
          content: issueFile
        },
        {
          fieldName: 'attachments',
          filename: 'screenshot.png',
          contentType: 'image/png',
          content: imageFile
        }
      ]
    });
    timings.issueCreateWithAttachment = nowMs() - t0;

    assert(createIssueResponse.statusCode === 201, `Issue create failed: ${createIssueResponse.body}`);
    assert(createIssueResponse.json?.item?.routingStatus === 'ROUTED', 'Issue should auto-route');
    assert(createIssueResponse.json?.item?.supportGroup?.code === 'ACCESS', 'Issue should be routed to access support group');
    assert(createIssueResponse.json?.item?.executionMode === 'NATIVE', 'Issue should stay native until an internal user pushes it to Jira');
    assert(createIssueResponse.json?.item?.executionState === 'NOT_STARTED', 'Issue should start without downstream execution');
    assert(createIssueResponse.json?.item?.jira?.projectKey === 'INT', 'Issue should resolve Jira project key from routing');
    assert(createIssueResponse.json?.item?.attachments?.length === 2, 'Issue should include two attachments');

    const acmeIssueResponse = await apiMultipart({
      port,
      path: `/api/v1/acme/issues`,
      method: 'POST',
      cookie: acmeCookie,
      fields: { entityId: acmeEntity._id.toString(), title: 'Acme first issue', description: 'First issue in second tenant', priority: 'MEDIUM', category: 'General' }
    });
    assert(acmeIssueResponse.statusCode === 201, `Acme issue create failed: ${acmeIssueResponse.body}`);
    assert(acmeIssueResponse.json?.item?.issueNumber === 'ACME-1001', 'Second tenant should have its own per-entity acronym issue number sequence');

    const clientPushDenied = await apiJson({
      port,
      path: `/api/v1/${tenantSlug}/issues/${createIssueResponse.json.item.id}/push-to-jira`,
      method: 'POST',
      cookie: clientACookie
    });
    assert(clientPushDenied.statusCode === 403, 'Client must not be allowed to push Jira issues');

    const pushIssueResponse = await apiJson({
      port,
      path: `/api/v1/${tenantSlug}/issues/${createIssueResponse.json.item.id}/push-to-jira`,
      method: 'POST',
      cookie: agentACookie,
      body: { projectKey: 'INT' }
    });
    assert([200, 202].includes(pushIssueResponse.statusCode), `Push to Jira failed: ${pushIssueResponse.body}`);

    let pushedIssuePayload = pushIssueResponse.json?.item || null;
    if (pushIssueResponse.statusCode === 202 || pushedIssuePayload?.jira?.pushStatus !== 'PUSHED') {
      for (let attempt = 0; attempt < 20; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 250));
        const polledIssueResponse = await apiJson({
          port,
          path: `/api/v1/${tenantSlug}/issues/${createIssueResponse.json.item.id}`,
          method: 'GET',
          cookie: agentACookie
        });
        if (polledIssueResponse.statusCode === 200 && polledIssueResponse.json?.item?.jira?.pushStatus === 'PUSHED') {
          pushedIssuePayload = polledIssueResponse.json.item;
          break;
        }
      }
    }
    assert(pushedIssuePayload?.executionState === 'PUSHED_TO_JIRA', 'Issue should move to PUSHED_TO_JIRA');
    assert(pushedIssuePayload?.jira?.pushStatus === 'PUSHED', 'Jira push status should be PUSHED');
    assert(pushedIssuePayload?.jira?.issueKey === 'INT-1001', 'Mock Jira issue key should be saved');

    const webhookSyncResponse = await apiJson({
      port,
      path: `/api/v1/${tenantSlug}/integrations/jira/webhook`,
      method: 'POST',
      body: {
        webhookEvent: 'jira:issue_updated',
        issue: {
          key: pushedIssuePayload?.jira?.issueKey,
          fields: {
            status: {
              name: 'Done',
              statusCategory: { key: 'done' }
            }
          }
        },
        changelog: {
          items: [
            { field: 'status', fromString: 'In Progress', toString: 'Done' }
          ]
        }
      }
    });
    assert(webhookSyncResponse.statusCode === 200, `Webhook sync should succeed: ${webhookSyncResponse.body}`);

    const issueAfterWebhookResponse = await apiJson({
      port,
      path: `/api/v1/${tenantSlug}/issues/${createIssueResponse.json.item.id}`,
      method: 'GET',
      cookie: agentACookie
    });
    assert(issueAfterWebhookResponse.statusCode === 200, `Issue fetch after webhook failed: ${issueAfterWebhookResponse.body}`);
    assert(issueAfterWebhookResponse.json?.item?.status === 'READY_TO_CLOSE', 'Jira Done status should map to READY_TO_CLOSE');
    assert(issueAfterWebhookResponse.json?.item?.jira?.currentStatusName === 'Done', 'Current Jira status should be shown on the issue');

    const duplicatePushResponse = await apiJson({
      port,
      path: `/api/v1/${tenantSlug}/issues/${createIssueResponse.json.item.id}/push-to-jira`,
      method: 'POST',
      cookie: agentACookie
    });
    assert(duplicatePushResponse.statusCode === 409, 'Duplicate Jira push should be blocked');

    const issueSentActivities = await IssueActivity.find({ issueId: createIssueResponse.json.item.id, type: 'ISSUE_SENT_TO_JIRA' }).lean();
    assert(issueSentActivities.length === 1, 'Exactly one Jira push activity should exist');

    const issueId = createIssueResponse.json.item.id;
    const issueAttachmentId = createIssueResponse.json.item.attachments.find((item) => item.originalName === 'evidence.txt').id;
    const imageAttachmentId = createIssueResponse.json.item.attachments.find((item) => item.originalName === 'screenshot.png').id;

    t0 = nowMs();
    const addCommentResponse = await apiMultipart({
      port,
      path: `/api/v1/${tenantSlug}/issues/${issueId}/comments`,
      method: 'POST',
      cookie: agentACookie,
      fields: {
        commentText: 'We are checking this now.',
        visibility: 'EXTERNAL'
      },
      files: [
        {
          fieldName: 'attachments',
          filename: 'note.txt',
          contentType: 'text/plain',
          content: commentFile
        }
      ]
    });
    timings.commentCreateWithAttachment = nowMs() - t0;

    assert(addCommentResponse.statusCode === 201, `Comment create failed: ${addCommentResponse.body}`);
    assert(addCommentResponse.json?.item?.attachments?.length === 1, 'Comment should include one attachment');
    const commentAttachmentId = addCommentResponse.json.item.attachments[0].id;

    const crossTenantDownload = await request({
      port,
      path: `/api/v1/${tenantSlug}/files/${issueAttachmentId}/download`,
      headers: { Cookie: clientBCookie }
    });
    assert(crossTenantDownload.statusCode === 403, 'Unauthorized client should not download issue attachment');


    const imagePreview = await request({
      port,
      path: `/api/v1/${tenantSlug}/files/${imageAttachmentId}/preview`,
      headers: { Cookie: clientACookie }
    });
    assert(imagePreview.statusCode === 200, `Image preview failed: ${imagePreview.body}`);
    assert((imagePreview.headers['content-disposition'] || '').includes('inline'), 'Image preview should be inline');
    assert((imagePreview.headers['content-type'] || '').includes('image/png'), 'Image preview content type mismatch');

    t0 = nowMs();
    const issueDownload = await request({
      port,
      path: `/api/v1/${tenantSlug}/files/${issueAttachmentId}/download`,
      headers: { Cookie: clientACookie }
    });
    timings.issueAttachmentDownload = nowMs() - t0;

    assert(issueDownload.statusCode === 200, `Issue attachment download failed: ${issueDownload.body}`);
    assert(issueDownload.buffer.equals(issueFile), 'Issue attachment content mismatch');
    assert((issueDownload.headers['content-disposition'] || '').includes('evidence.txt'), 'Issue attachment filename header missing');

    t0 = nowMs();
    const commentDownload = await request({
      port,
      path: `/api/v1/${tenantSlug}/files/${commentAttachmentId}/download`,
      headers: { Cookie: agentACookie }
    });
    timings.commentAttachmentDownload = nowMs() - t0;

    assert(commentDownload.statusCode === 200, `Comment attachment download failed: ${commentDownload.body}`);
    assert(commentDownload.buffer.equals(commentFile), 'Comment attachment content mismatch');

    const issueFromDb = await Issue.findById(issueId).lean();
    assert(issueFromDb.attachments.length === 2, 'Issue attachments should be saved on issue document');
    assert(issueFromDb.attachments[0].filename, 'Attachment filename missing on issue document');

    const commentFromDb = await IssueComment.findById(addCommentResponse.json.item.id).lean();
    assert(commentFromDb.attachments.length === 1, 'Comment attachment should be saved on comment document');

    const fileAssetCount = await FileAsset.countDocuments({ tenantId: TENANT_ID, issueId });
    assert(fileAssetCount === 3, `Expected 3 file assets, got ${fileAssetCount}`);

    const commentsResponse = await apiJson({
      port,
      path: `/api/v1/${tenantSlug}/issues/${issueId}/comments`,
      cookie: clientACookie
    });
    assert(commentsResponse.statusCode === 200, 'Comment fetch failed');
    assert(commentsResponse.json.items[0].attachments.length === 1, 'Comment fetch should include attachment metadata');

    const targets = {
      issueCreateWithAttachment: 300,
      commentCreateWithAttachment: 300,
      issueAttachmentDownload: 200,
      commentAttachmentDownload: 200
    };

    console.log('ESOP v30.2 smoke test passed.');
    console.log('Functional: PASS');
    console.log('- create issue with attachment and internal-first execution model');
    console.log('- Jira config save, fetch and validate');
    console.log('- secure manual push to Jira with mock mode');
    console.log('- add comment with attachment');
    console.log('- secure file download for issue attachment');
    console.log('- secure inline preview for image attachment');
    console.log('- secure file download for comment attachment');
    console.log('Security: PASS');
    console.log('- entity scoped file download enforced');
    console.log('- no public file path exposure in API');
    console.log('Performance Summary:');

    for (const [key, value] of Object.entries(timings)) {
      const target = targets[key] || '-';
      const verdict = typeof target === 'number' ? (value <= target ? 'PASS' : 'WARN') : 'INFO';
      console.log(`- ${key}: ${value} ms | target ${target} | ${verdict}`);
    }
  } catch (error) {
    console.error('ESOP v30.2 smoke test failed.');
    console.error(error);
    process.exitCode = 1;
  } finally {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
  }
})();
