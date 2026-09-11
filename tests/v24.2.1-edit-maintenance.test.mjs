import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(new URL('..', import.meta.url).pathname);
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const json = (p) => JSON.parse(read(p));

test('client Edit button has a real edit dialog while Priority stays support-only', () => {
  const ejs = read('apps/web/src/views/pages/request-detail.ejs');
  assert.match(ejs, /<% if \(!isTerminalRequest\) \{ %>\s*<dialog class="modal wide" id="editRequestModal">/);
  assert.match(ejs, /<% if \(portal !== 'client'\) \{ %><label><span>Priority<\/span>/);
  assert.match(ejs, /Priority and internal lifecycle fields are intentionally hidden from clients/);
});

test('SLA notifier startup retries dependency races instead of dumping first ECONNREFUSED', () => {
  const app = read('apps/web/src/app.js');
  assert.match(app, /async function bootstrapSlaNotifier\(attempt = 1\)/);
  assert.match(app, /dependent services are not ready; retrying/);
  assert.match(app, /bootstrap failed after \$\{maxAttempts\} attempts/);
});

test('Maintenance Request has six configured subtype forms and uses the supplied common workflow', () => {
  const forms = json('config/v24-saas/form-definitions.json').forms.filter((x) => x.family === 'MAINTENANCE');
  assert.equal(forms.length, 6);
  const bySubtype = new Map(forms.map((x) => [x.subtype, x]));
  for (const subtype of ['Scheduled Maintenance','Proactive Maintenance','Emergency Maintenance','Vulnerability Run','Penetration Test Run','Actual DR']) {
    assert.ok(bySubtype.has(subtype), `missing ${subtype}`);
    assert.equal(bySubtype.get(subtype).workflowKey, 'WF_SAAS_MAINTENANCE');
    assert.equal(bySubtype.get(subtype).clientPrioritySelectable, false);
  }
});

test('Maintenance release and security/DR forms carry their required configurable fields', () => {
  const forms = json('config/v24-saas/form-definitions.json').forms;
  const get = (key) => forms.find((x) => x.key === key);
  const keys = (form) => new Set(form.fields.map((x) => x.key));
  for (const key of ['SAAS_MR_SCHEDULED','SAAS_MR_PROACTIVE','SAAS_MR_EMERGENCY']) {
    const f = get(key); assert.ok(f);
    for (const field of ['MAINTENANCE_RELEASE_REQUEST','RELEASE_ID','COMPONENTS','PURPOSE_OF_PACK','TEST_CASE_LINK','DURATION_HOURS','REQUEST_DUE_DATE','APPROVER','EXCEPTION_APPROVER','TEST_EXECUTION_LINKS']) assert.ok(keys(f).has(field), `${key} missing ${field}`);
  }
  for (const field of ['COMPONENTS_SCANNED','DATE_OF_SCAN']) assert.ok(keys(get('SAAS_MR_VULNERABILITY')).has(field));
  for (const field of ['COMPONENTS_SCANNED','DATE_OF_SCAN']) assert.ok(keys(get('SAAS_MR_PEN_TEST')).has(field));
  for (const field of ['DR_LOCATION','DR_INITIATION_DATE','REASON','DR_SWITCHOVER_TIME','DR_ACTIVITY_CLOSURE_DATE']) assert.ok(keys(get('SAAS_MR_ACTUAL_DR')).has(field));
});

test('Maintenance workflow contains JSM states and branch creation actions', () => {
  const wf = json('config/v24-saas/workflows.json').workflows.find((x) => x.key === 'WF_SAAS_MAINTENANCE');
  assert.ok(wf);
  const statuses = new Set(wf.statuses.map((x) => x.key));
  for (const s of ['NEW','ANALYSIS','APPROVED','REJECTED','CANCELLED','COMPLETED','CLOSED','SNAPSHOT_REVERT','INITIATE_SWITCH_DR','SWITCHED_DR','INITIATE_SWITCH_PRIMARY','SWITCHED_PRIMARY','BCP_REPORT_PREP','PUBLISH_BCP_REPORT','VA_REPORT','PT_REPORT','INCIDENT_CREATED','PROBLEM_CREATED','SERVICE_REQUEST_CREATED']) assert.ok(statuses.has(s), `missing ${s}`);
  const labels = new Set(wf.transitions.map((x) => x.label));
  for (const label of ['Start Analysis','Approve','Reject','Reopen Request','Cancel Request','Complete','Create Incident','Create Problem','Create Service Request']) assert.ok(labels.has(label), `missing transition ${label}`);
});

test('Maintenance mappings are runtime-bindable and SLA remains inapplicable', () => {
  const manifest = json('config/v24-saas/service-model.json');
  assert.equal(manifest.version, '24.2.1');
  assert.equal(manifest.sla.maintenanceRequest.applicable, false);
  const bindings = json('config/v24-saas/subtype-workflow-map.json').bindings.filter((x) => x.family === 'MAINTENANCE');
  assert.equal(bindings.length, 6);
  for (const b of bindings) {
    assert.equal(b.workflowKey, 'WF_SAAS_MAINTENANCE');
    assert.equal(b.inheritWorkflowFromIssueType, true);
    assert.equal(b.inheritSlaFromIssueType, true);
    assert.equal(b.inheritSupportPathFromIssueType, false);
  }
});

test('controlled SunTec migration provisions and verifies Maintenance Request', () => {
  const script = read('scripts/migrate-suntecgroup-to-v24.2.1.mjs');
  assert.match(script, /const V24_VERSION = '24\.2\.1'/);
  assert.match(script, /MAINTENANCE_WORKFLOW_KEY = 'WF_SAAS_MAINTENANCE'/);
  assert.match(script, /findMaintenanceTaxonomy/);
  assert.match(script, /migrateMaintenanceTaxonomy/);
  assert.match(script, /upsertV24ConfigurationStore/);
  assert.match(script, /slaApplicable = false/);
  assert.match(script, /Existing subtype-specific Maintenance support paths/);
});


test('tenant request URLs expose the same edit POST action as portal URLs', () => {
  const app = read('apps/web/src/app.js');
  assert.match(app, /app\.post\('\/:tenant\/requests\/:requestId\/edit'[\s\S]*?handleRequestEdit\(req, res, next, access\.portal\)/);
  assert.doesNotMatch(app, /This page is not available in Service Desk v19\.7/);
});

test('edit custom dropdowns restore an existing value robustly, including Further Classification', () => {
  const ejs = read('apps/web/src/views/pages/request-detail.ejs');
  assert.match(ejs, /request\.customFieldValues \|\| request\.customFields/);
  assert.match(ejs, /existing\.value \?\? existing\.displayValue/);
  assert.match(ejs, /normalizedEditValue\(existingScalar\) === normalizedEditValue\(choice\)/);
  const css = read('apps/web/src/public/css/app.css');
  assert.match(css, /\.rail-edit-request\{[^}]*padding:3px 8px/);
});
