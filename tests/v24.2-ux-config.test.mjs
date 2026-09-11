import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8');

test('v24.2 hides Priority from the client workspace while retaining support controls', () => {
  const registry = JSON.parse(read('config/v24-saas/field-registry.json'));
  const priority = registry.fields.find((field) => field.key === 'PRIORITY');
  assert.equal(priority.permissions.client.viewVisible, false);
  assert.equal(priority.permissions.client.createVisible, false);
  assert.equal(priority.permissions.client.postCreateEditable, false);
  const list = read('apps/web/src/views/pages/requests.ejs');
  const detail = read('apps/web/src/views/pages/request-detail.ejs');
  assert.match(list, /portal !== 'client'.*<th>Priority<\/th>/s);
  assert.match(detail, /portal !== 'client'.*<dt>Priority<\/dt>/s);
});

test('v24.2 client may edit Severity but never Priority', async () => {
  const core = await import('../lib/v24-saas-core.mjs');
  const req = { serviceModelKey: 'SUNTEC_SAAS_V24' };
  assert.equal(core.canPostCreateChangeClassification(req, 'client', 'severity'), true);
  assert.equal(core.canPostCreateChangeClassification(req, 'client', 'priority'), false);
  const service = read('services/request-service/src/app.js');
  assert.match(service, /Priority is controlled by support and is not visible to client users/);
  assert.match(service, /requests\/:requestId\/details/);
});

test('v24.2 Change status does not duplicate action and destination labels', () => {
  const detail = read('apps/web/src/views/pages/request-detail.ejs');
  assert.doesNotMatch(detail, /→ \$\{target\.name\}/);
  assert.match(detail, /action\.name \|\| action\.label \|\| target\.name/);
});

test('v24.2 dynamic intake stepper hides before client selection and omits singleton taxonomy steps', () => {
  const intake = read('apps/web/src/views/pages/request-new.ejs');
  assert.match(intake, /const clientChosen = Boolean\(selectedClient\)/);
  assert.match(intake, /familyChoices\.length > 1/);
  assert.match(intake, /issueChoices\.length > 1/);
  assert.match(intake, /subtypeChoices\.length > 1/);
  assert.match(intake, /if \(steps\.length\)/);
});

test('v24.2 request grid preserves full issue key and full-width search', () => {
  const css = read('apps/web/src/public/css/app.css');
  assert.match(css, /wide-search\{grid-column:1\/-1/);
  assert.match(css, /request-id-link\{[^}]*overflow:visible[^}]*text-overflow:clip/s);
  assert.match(css, /request-table-wrap\{overflow-x:auto/);
});

test('v24.2 renders semantic status pills including a distinct Closed state', () => {
  const css = read('apps/web/src/public/css/app.css');
  const list = read('apps/web/src/views/pages/requests.ejs');
  assert.match(list, /status-compact status-/);
  assert.match(css, /status-compact\.status-closed/);
});

test('v24.2 does not expose implementation workflow names in current-stage controls', () => {
  const detail = read('apps/web/src/views/pages/request-detail.ejs');
  assert.doesNotMatch(detail, /stage\.label \|\| stage\.workflow\?\.name/);
  assert.match(detail, /stage\.label \|\| 'Support stage'/);
});

test('v24.2 migration provisions Components plus Problem and Change workflows', () => {
  const migration = read('scripts/migrate-suntecgroup-to-v24.2.mjs');
  assert.match(migration, /WF_SAAS_PROBLEM/);
  assert.match(migration, /WF_SAAS_CHANGE/);
  assert.match(migration, /'COMPONENTS'/);
  assert.match(migration, /mergeConfiguredCustomFields/);
});

test('v24.2 L3 view includes customer-raised S1 incidents currently active at L2', () => {
  const web = read('apps/web/src/app.js');
  assert.match(web, /l3WatchView/);
  assert.match(web, /level === 'L2' && severity === 'S1' && customerRaised && incident/);
});

test('v24.2 client-level mail policy supports core request events', () => {
  const client = read('services/organization-service/src/models/Client.js');
  const web = read('apps/web/src/app.js');
  for (const key of ['issueCreated','issueEdited','statusChanged','issueClosed','commentAdded','assignmentChanged','severityChanged','priorityChanged','slaAtRisk','slaBreached']) {
    assert.ok(client.includes(key), `${key} missing from client notification policy`);
  }
  assert.match(web, /requestClient\?\.notificationMode === 'custom'/);
  assert.match(web, /eventPolicyKey/);
});

test('v24.2 line remains compatible and Problem/Change configs exist', () => {
  const model = JSON.parse(read('config/v24-saas/service-model.json'));
  const workflows = JSON.parse(read('config/v24-saas/workflows.json'));
  assert.match(model.version, /^24\.2\./);
  const keys = new Set(workflows.workflows.map((item) => item.key));
  assert.ok(keys.has('WF_SAAS_PROBLEM'));
  assert.ok(keys.has('WF_SAAS_CHANGE'));
});
