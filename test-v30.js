require('dotenv').config();
const http = require('http');
const querystring = require('querystring');
const mongoose = require('mongoose');
const { connectDb } = require('./src/config/db');
const { createApp } = require('./src/app');
const { Tenant } = require('./src/modules/tenant/tenant.model');
const { Entity } = require('./src/modules/entities/entity.model');
const { User } = require('./src/modules/users/user.model');
const { UserEntityMembership } = require('./src/modules/memberships/membership.model');
const { Issue } = require('./src/modules/issues/issue.model');
const { RoutingRule } = require('./src/modules/routing/routing-rule.model');
const { SlaPolicy } = require('./src/modules/sla/sla-policy.model');
const { StatusMapping } = require('./src/modules/status-mappings/status-mapping.model');
const { SupportGroup } = require('./src/modules/support-groups/support-group.model');
const { AuditLog } = require('./src/modules/audit/audit.model');
const { createUserForTenant } = require('./src/modules/users/user.service');

const TENANT_ID = new mongoose.Types.ObjectId('64a000000000000000000030');
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
  const loginPage = await request({ port, path: '/suntec/login' });
  const cookies = extractCookies(loginPage.headers['set-cookie'] || []);
  const csrfToken = extractCsrfToken(loginPage.body);
  const payload = querystring.stringify({ email, password, _csrf: csrfToken });
  const response = await request({ port, path: '/suntec/login', method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(payload), Cookie: cookies }, body: payload });
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
    process.env.JIRA_MOCK_MODE = 'true';
    process.env.ALLOW_JIRA_MOCK_OUTSIDE_TEST = 'true';
    await connectDb();
    await Promise.all([
      RoutingRule.deleteMany({ tenantId: TENANT_ID }),
      SlaPolicy.deleteMany({ tenantId: TENANT_ID }),
      StatusMapping.deleteMany({ tenantId: TENANT_ID }),
      SupportGroup.deleteMany({ tenantId: TENANT_ID }),
      AuditLog.deleteMany({ tenantId: TENANT_ID }),
      Issue.deleteMany({ tenantId: TENANT_ID }),
      UserEntityMembership.deleteMany({ tenantId: TENANT_ID }),
      User.deleteMany({ tenantId: TENANT_ID }),
      Entity.deleteMany({ tenantId: TENANT_ID }),
      Tenant.deleteMany({ _id: TENANT_ID })
    ]);

    await Tenant.create({ _id: TENANT_ID, name: 'SunTec', slug: 'suntec', status: 'active' });
    const entity = await Entity.create({ tenantId: TENANT_ID, name: 'Admin Client', acronym: 'ADMC', type: 'client', path: 'Admin Client', metadata: { region: 'UAE', product: 'ESOP', slaTier: 'Gold' } });
    const group = await SupportGroup.create({ tenantId: TENANT_ID, name: 'L2 Ops', code: 'L2OPS', description: 'Routing group' });
    const superadmin = await createUserForTenant({ tenantId: TENANT_ID, name: 'Superadmin', email: 'superadminv30@local.test', password: PASSWORD, role: 'superadmin' });
    const agent = await createUserForTenant({ tenantId: TENANT_ID, name: 'Agent', email: 'agentv30@local.test', password: PASSWORD, role: 'agent', entityIds: [entity._id.toString()] });
    const client = await createUserForTenant({ tenantId: TENANT_ID, name: 'Client', email: 'clientv30@local.test', password: PASSWORD, role: 'client', entityId: entity._id.toString() });
    await Issue.create({ tenantId: TENANT_ID, entityId: entity._id, issueNumber: 'ADMC-1001', title: 'Internal issue', description: 'Hidden', category: 'OPS', createdByUserId: agent._id, lastUpdatedByUserId: agent._id, reporterType: 'agent', status: 'OPEN', priority: 'HIGH', executionMode: 'NATIVE', executionState: 'NOT_STARTED', customerVisibility: 'INTERNAL_ONLY' });

    const app = createApp();
    server = app.listen(0);
    const port = await new Promise((resolve) => server.on('listening', () => resolve(server.address().port)));
    const superCookie = await loginSession(port, 'superadminv30@local.test', PASSWORD);
    const clientCookie = await loginSession(port, 'clientv30@local.test', PASSWORD);

    const adminConsole = await request({ port, path: '/suntec/admin/console', headers: { Cookie: superCookie } });
    assert(adminConsole.statusCode === 200 && adminConsole.body.includes('Admin Console'), 'Admin console should load for superadmin');

    const adminSummary = await apiJson({ port, path: '/api/v1/suntec/admin/console/summary', cookie: superCookie });
    assert(adminSummary.statusCode === 200 && adminSummary.json.item.internalOnlyIssues === 1, 'Admin summary should include internal-only issue count');

    const routingCreate = await apiJson({ port, path: '/api/v1/suntec/routing-rules', method: 'POST', cookie: superCookie, body: { name: 'OPS route', category: 'OPS', priority: 'HIGH', supportGroupId: group._id.toString(), defaultAssigneeUserId: agent._id.toString(), entityId: entity._id.toString(), executionMode: 'JIRA', jiraProjectKey: 'SOL', rank: 10, isActive: true } });
    assert(routingCreate.statusCode === 201, 'Routing rule should be created');

    const slaCreate = await apiJson({ port, path: '/api/v1/suntec/sla-policies', method: 'POST', cookie: superCookie, body: { name: 'Gold SLA', agreementType: 'SLA', scopeLevel: 'CLIENT', entityId: entity._id.toString(), category: 'OPS', priority: 'HIGH', executionMode: 'JIRA', responseTargetMinutes: 60, resolutionTargetMinutes: 240, warningThresholdPercent: 80, rank: 10, isActive: true } });
    assert(slaCreate.statusCode === 201, 'SLA policy should be created');

    const statusMappingCreate = await apiJson({ port, path: '/api/v1/suntec/status-mappings', method: 'POST', cookie: superCookie, body: { jiraProjectKey: 'SOL', internalStatus: 'IN_PROGRESS', customerLabel: 'Engineering in progress', badgeTone: 'brand-soft', rank: 10, isActive: true } });
    assert(statusMappingCreate.statusCode === 201, 'Status mapping should be created');

    const userUpdate = await apiJson({ port, path: `/api/v1/suntec/users/${agent._id.toString()}`, method: 'PUT', cookie: superCookie, body: { name: 'Agent Updated', email: 'agentv30@local.test', role: 'agent', isActive: true, entityIds: [entity._id.toString()] } });
    assert(userUpdate.statusCode === 200 && userUpdate.json.item.name === 'Agent Updated', 'User update should work');

    const clientAdminConsole = await request({ port, path: '/suntec/admin/console', headers: { Cookie: clientCookie } });
    assert(clientAdminConsole.statusCode === 302, 'Client user should not access admin console');

    console.log('ESOP v30 smoke test passed.');
    console.log('- admin console page and summary API');
    console.log('- routing rule creation');
    console.log('- SLA policy creation');
    console.log('- status mapping creation');
    console.log('- admin user update');
    console.log('- client denied from admin console');
  } catch (error) {
    console.error('ESOP v30 smoke test failed.');
    console.error(error);
    process.exitCode = 1;
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
  }
})();
