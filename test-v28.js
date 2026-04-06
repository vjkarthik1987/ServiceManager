
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
const { SavedView } = require('./src/modules/saved-views/saved-view.model');
const { createUserForTenant } = require('./src/modules/users/user.service');
const { Tenant } = require('./src/modules/tenant/tenant.model');

const TENANT_ID = new mongoose.Types.ObjectId('64a000000000000000000011');
const PASSWORD = 'password';

function request({ port, path, method = 'GET', headers = {}, body = null }) {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port, path, method, headers }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
      res.on('end', () => resolve({ statusCode: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}
function extractCookies(setCookieHeader = []) { return setCookieHeader.map((value) => value.split(';')[0]).join('; '); }
function extractCsrfToken(html) { const match = html.match(/name="_csrf" value="([^"]+)"/); return match ? match[1] : null; }
async function loginSession(port, email, password) {
  const loginPath = '/suntec/login';
  const loginPage = await request({ port, path: loginPath });
  const cookies = extractCookies(loginPage.headers['set-cookie'] || []);
  const csrfToken = extractCsrfToken(loginPage.body);
  const payload = querystring.stringify({ email, password, _csrf: csrfToken });
  const response = await request({ port, path: loginPath, method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(payload), Cookie: cookies }, body: payload });
  return extractCookies(response.headers['set-cookie'] || []) || cookies;
}
async function apiJson({ port, path, method = 'GET', cookie, body }) {
  const response = await request({ port, path, method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}), 'x-test-bypass-csrf': '1' }, body: body ? JSON.stringify(body) : null });
  let parsed = null; try { parsed = response.body ? JSON.parse(response.body) : null; } catch (e) {}
  return { ...response, json: parsed };
}
function assert(condition, message) { if (!condition) throw new Error(message); }

(async () => {
  let server;
  try {
    process.env.NODE_ENV = 'test';
    await connectDb();
    await Promise.all([
      SavedView.deleteMany({ tenantId: TENANT_ID }),
      Issue.deleteMany({ tenantId: TENANT_ID }),
      UserEntityMembership.deleteMany({ tenantId: TENANT_ID }),
      User.deleteMany({ tenantId: TENANT_ID }),
      Entity.deleteMany({ tenantId: TENANT_ID }),
      Tenant.deleteMany({ _id: TENANT_ID })
    ]);

    await Tenant.create({ _id: TENANT_ID, name: 'SunTec', slug: 'suntec', status: 'active' });
    const entity = await Entity.create({ tenantId: TENANT_ID, name: 'Workspace Client', acronym: 'WSC', type: 'client', path: 'Workspace Client', metadata: {} });
    const superadmin = await createUserForTenant({ tenantId: TENANT_ID, name: 'Superadmin', email: 'superadminv28@local.test', password: PASSWORD, role: 'superadmin' });
    const agent = await createUserForTenant({ tenantId: TENANT_ID, name: 'Agent', email: 'agentv28@local.test', password: PASSWORD, role: 'agent', entityIds: [entity._id.toString()] });
    const client = await createUserForTenant({ tenantId: TENANT_ID, name: 'Client', email: 'clientv28@local.test', password: PASSWORD, role: 'client', entityId: entity._id.toString() });
    const issue = await Issue.create({ tenantId: TENANT_ID, entityId: entity._id, issueNumber: 'WSC-1001', title: 'Workspace issue', description: 'Test', category: 'General', createdByUserId: client._id, lastUpdatedByUserId: client._id, reporterType: 'client_user', status: 'OPEN', priority: 'HIGH', triageStatus: 'IN_TRIAGE', executionMode: 'NATIVE', executionState: 'NOT_STARTED' });

    const app = createApp();
    server = app.listen(0);
    const port = await new Promise((resolve) => server.on('listening', () => resolve(server.address().port)));

    const agentCookie = await loginSession(port, 'agentv28@local.test', PASSWORD);
    const clientCookie = await loginSession(port, 'clientv28@local.test', PASSWORD);
    const superadminCookie = await loginSession(port, 'superadminv28@local.test', PASSWORD);

    const workspacePage = await request({ port, path: '/suntec/agent/workspace', headers: { Cookie: agentCookie } });
    assert(workspacePage.statusCode === 200, 'Agent workspace page should be accessible to agent');

    const workspaceDenied = await request({ port, path: '/suntec/agent/workspace', headers: { Cookie: clientCookie } });
    assert([302, 403].includes(workspaceDenied.statusCode), 'Client should not access agent workspace');

    const summary = await apiJson({ port, path: '/api/v1/suntec/agent/workspace/summary', cookie: agentCookie });
    assert(summary.statusCode === 200, 'Workspace summary API should work');
    assert(typeof summary.json?.item?.allAccessibleIssues === 'number', 'Workspace summary should include counts');

    const savedViewCreate = await apiJson({ port, path: '/api/v1/suntec/saved-views', method: 'POST', cookie: agentCookie, body: { name: 'My Open Queue', queue: 'MY_OPEN', status: 'OPEN', isDefault: true } });
    assert(savedViewCreate.statusCode === 201, 'Saved view create should work');
    const savedViewId = savedViewCreate.json.item._id;

    const savedViewUpdate = await apiJson({ port, path: `/api/v1/suntec/saved-views/${savedViewId}`, method: 'PUT', cookie: agentCookie, body: { name: 'My Updated Queue', status: 'OPEN', priority: 'HIGH', isDefault: true } });
    assert(savedViewUpdate.statusCode === 200, 'Saved view update should work');

    const workspaceIssues = await apiJson({ port, path: '/api/v1/suntec/agent/workspace/issues?queue=ALL', cookie: agentCookie });
    assert(workspaceIssues.statusCode === 200, 'Workspace issue list should work');
    assert(Array.isArray(workspaceIssues.json?.items) && workspaceIssues.json.items.length === 1, 'Workspace issues should be returned');

    const bulk = await apiJson({ port, path: '/api/v1/suntec/issues/bulk-update', method: 'POST', cookie: superadminCookie, body: { issueIds: [issue._id.toString()], action: 'CHANGE_STATUS', payload: { status: 'IN_PROGRESS' } } });
    assert(bulk.statusCode === 200, 'Bulk update should work');
    assert(bulk.json.updatedCount === 1, 'Bulk update should modify one issue');

    const savedViewDelete = await apiJson({ port, path: `/api/v1/suntec/saved-views/${savedViewId}`, method: 'DELETE', cookie: agentCookie });
    assert(savedViewDelete.statusCode === 200, 'Saved view delete should work');

    console.log('ESOP v28 smoke test passed.');
    console.log('- agent workspace page access');
    console.log('- client blocked from workspace');
    console.log('- workspace summary API');
    console.log('- saved view CRUD');
    console.log('- workspace issue listing');
    console.log('- bulk update route');
  } catch (error) {
    console.error('ESOP v28 smoke test failed.');
    console.error(error);
    process.exitCode = 1;
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
  }
})();
