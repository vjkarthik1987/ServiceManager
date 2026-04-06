
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

const TENANT_ID = new mongoose.Types.ObjectId('64a000000000000000000021');
const PASSWORD = 'password';
function request({ port, path, method = 'GET', headers = {}, body = null }) { return new Promise((resolve, reject) => { const req = http.request({ hostname: '127.0.0.1', port, path, method, headers }, (res) => { const chunks = []; res.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))); res.on('end', () => resolve({ statusCode: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') })); }); req.on('error', reject); if (body) req.write(body); req.end(); }); }
function extractCookies(setCookieHeader = []) { return setCookieHeader.map((value) => value.split(';')[0]).join('; '); }
function extractCsrfToken(html) { const match = html.match(/name="_csrf" value="([^"]+)"/); return match ? match[1] : null; }
async function loginSession(port, email, password) { const loginPage = await request({ port, path: '/suntec/login' }); const cookies = extractCookies(loginPage.headers['set-cookie'] || []); const csrfToken = extractCsrfToken(loginPage.body); const payload = querystring.stringify({ email, password, _csrf: csrfToken }); const response = await request({ port, path: '/suntec/login', method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(payload), Cookie: cookies }, body: payload }); return extractCookies(response.headers['set-cookie'] || []) || cookies; }
async function apiJson({ port, path, method = 'GET', cookie, body }) { const response = await request({ port, path, method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}), 'x-test-bypass-csrf': '1' }, body: body ? JSON.stringify(body) : null }); let parsed = null; try { parsed = response.body ? JSON.parse(response.body) : null; } catch (e) {} return { ...response, json: parsed }; }
function assert(condition, message) { if (!condition) throw new Error(message); }

(async () => {
  let server;
  try {
    process.env.NODE_ENV = 'test';
    await connectDb();
    await Promise.all([SavedView.deleteMany({ tenantId: TENANT_ID }), Issue.deleteMany({ tenantId: TENANT_ID }), UserEntityMembership.deleteMany({ tenantId: TENANT_ID }), User.deleteMany({ tenantId: TENANT_ID }), Entity.deleteMany({ tenantId: TENANT_ID }), Tenant.deleteMany({ _id: TENANT_ID })]);
    await Tenant.create({ _id: TENANT_ID, name: 'SunTec', slug: 'suntec', status: 'active' });
    const entity = await Entity.create({ tenantId: TENANT_ID, name: 'Portal Client', acronym: 'PCL', type: 'client', path: 'Portal Client', metadata: {} });
    const superadmin = await createUserForTenant({ tenantId: TENANT_ID, name: 'Superadmin', email: 'superadminv29@local.test', password: PASSWORD, role: 'superadmin' });
    const agent = await createUserForTenant({ tenantId: TENANT_ID, name: 'Agent', email: 'agentv29@local.test', password: PASSWORD, role: 'agent', entityIds: [entity._id.toString()] });
    const client = await createUserForTenant({ tenantId: TENANT_ID, name: 'Client', email: 'clientv29@local.test', password: PASSWORD, role: 'client', entityId: entity._id.toString() });
    const visibleIssue = await Issue.create({ tenantId: TENANT_ID, entityId: entity._id, issueNumber: 'PCL-1001', title: 'Visible issue', description: 'Shown to client', category: 'General', createdByUserId: client._id, lastUpdatedByUserId: client._id, reporterType: 'client_user', status: 'WAITING_FOR_CLIENT', priority: 'HIGH', triageStatus: 'NOT_TRIAGED', executionMode: 'NATIVE', executionState: 'NOT_STARTED', customerVisibility: 'VISIBLE_TO_CUSTOMER' });
    const internalIssue = await Issue.create({ tenantId: TENANT_ID, entityId: entity._id, issueNumber: 'PCL-1002', title: 'Internal issue', description: 'Hidden from client', category: 'General', createdByUserId: agent._id, lastUpdatedByUserId: agent._id, reporterType: 'agent', status: 'OPEN', priority: 'MEDIUM', triageStatus: 'IN_TRIAGE', executionMode: 'NATIVE', executionState: 'NOT_STARTED', customerVisibility: 'INTERNAL_ONLY' });
    const app = createApp(); server = app.listen(0); const port = await new Promise((resolve) => server.on('listening', () => resolve(server.address().port)));
    const clientCookie = await loginSession(port, 'clientv29@local.test', PASSWORD);
    const agentCookie = await loginSession(port, 'agentv29@local.test', PASSWORD);
    const superadminCookie = await loginSession(port, 'superadminv29@local.test', PASSWORD);
    const clientDashboard = await request({ port, path: '/suntec/client/dashboard', headers: { Cookie: clientCookie } });
    assert(clientDashboard.statusCode === 200, 'Client dashboard should load');
    const clientIssues = await request({ port, path: '/suntec/client/issues', headers: { Cookie: clientCookie } });
    assert(clientIssues.statusCode === 200 && clientIssues.body.includes('PCL-1001'), 'Client issue list should show visible issue');
    assert(!clientIssues.body.includes('PCL-1002'), 'Client issue list should hide internal issue');
    const clientOpenVisible = await request({ port, path: `/suntec/client/issues/${visibleIssue._id}`, headers: { Cookie: clientCookie } });
    assert(clientOpenVisible.statusCode === 200, 'Client should open visible issue');
    const clientOpenInternal = await request({ port, path: `/suntec/client/issues/${internalIssue._id}`, headers: { Cookie: clientCookie } });
    assert([302, 404].includes(clientOpenInternal.statusCode), 'Client should not access internal issue');
    const agentOpenInternal = await request({ port, path: `/suntec/tickets/${internalIssue._id}`, headers: { Cookie: agentCookie } });
    assert(agentOpenInternal.statusCode === 200, 'Agent should access internal issue');
    const internalCreate = await apiJson({ port, path: '/api/v1/suntec/issues', method: 'POST', cookie: superadminCookie, body: { entityId: entity._id.toString(), title: 'Internal created via API', description: 'Internal ticket', category: 'Ops', priority: 'LOW', customerVisibility: 'INTERNAL_ONLY', source: 'api' } });
    assert(internalCreate.statusCode === 201, 'Superadmin should create internal issue');
    assert(internalCreate.json.item.customerVisibility === 'INTERNAL_ONLY', 'Created issue should persist internal visibility');
    console.log('ESOP v29 smoke test passed.');
    console.log('- client dashboard');
    console.log('- customer-visible issue filtering');
    console.log('- internal issue hidden from client and visible to staff');
    console.log('- internal issue creation by staff');
  } catch (error) {
    console.error('ESOP v29 smoke test failed.');
    console.error(error);
    process.exitCode = 1;
  } finally { if (server) await new Promise((resolve) => server.close(resolve)); }
})();
