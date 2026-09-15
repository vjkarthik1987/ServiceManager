import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const json = (file) => JSON.parse(read(file));
const workflows = json('config/v24-saas/workflows.json').workflows;
const paths = json('config/v24-saas/support-paths.json').supportPaths;
const wf = (key) => workflows.find((x) => x.key === key);
const edges = (key) => wf(key).transitions;
const edge = (key, id) => edges(key).find((x) => x.key === id);
const destinations = (key, from) => edges(key).filter((x) => x.from === from).map((x) => x.to);

function hasEdge(key, from, to, label = null) {
  return edges(key).some((x) => x.from === from && x.to === to && (label == null || x.label === label));
}

test('v24.2.x manifest identifies the workflow-alignment release', () => {
  const manifest = json('config/v24-saas/service-model.json');
  assert.ok(['24.2.2','24.2.3'].includes(manifest.version));
  assert.match(manifest.ui.workflowAlignment, /Incident.*Problem.*Change Request.*Maintenance Request/i);
});

test('Incident client must enter Analysis before Request to L2 Support', () => {
  const incident = wf('WF_SAAS_INCIDENT');
  assert.ok(hasEdge(incident.key, 'NEW', 'ANALYSIS', 'Start Analysis'));
  assert.equal(incident.transitions.some((x) => x.from === 'NEW' && x.label === 'Request to L2 Support' && x.customerEnabled), false);
  assert.ok(hasEdge(incident.key, 'ANALYSIS', 'L2_SUPPORT', 'Request to L2 Support'));
  const supportPath = paths.find((x) => x.key === 'PATH_INCIDENT_COMMON_V24');
  const requestL2 = supportPath.movementRules.find((x) => x.localId === 'request_l2');
  assert.deepEqual(requestL2.allowedFromStatusIds, ['ANALYSIS','IN_PREPRODUCTION','TEST_FAILED']);
});

test('Incident Analysis exposes the requested JSM client action set and does not jump directly to Resolved', () => {
  const actions = edges('WF_SAAS_INCIDENT').filter((x) => x.from === 'ANALYSIS' && x.customerEnabled === true);
  const expected = new Map([
    ['Request to L2 Support','L2_SUPPORT'],
    ['Deferred','DEFERRED'],
    ['Duplicate','DUPLICATE'],
    ['Not an issue','NOT_AN_ISSUE'],
    ['Send to Preproduction','IN_PREPRODUCTION'],
    ['Close','CLOSED'],
    ['On Hold','ON_HOLD'],
    ['Under Monitoring','UNDER_MONITORING']
  ]);
  for (const [label, to] of expected) assert.ok(actions.some((x) => x.label === label && x.to === to), `missing ${label} -> ${to}`);
  assert.equal(actions.some((x) => x.to === 'RESOLVED'), false);
});

test('Incident preserves JSM L2/L3, monitoring, verification, failure and shared testing routes', () => {
  const key = 'WF_SAAS_INCIDENT';
  assert.ok(hasEdge(key,'L2_SUPPORT','L2_ANALYSIS','Start Analysis'));
  assert.ok(hasEdge(key,'L3_SUPPORT','L3_ANALYSIS','Start Analysis'));
  assert.ok(hasEdge(key,'L2_ANALYSIS','INTERIM_RESOLUTION','Interim Resolution'));
  assert.ok(hasEdge(key,'L2_ANALYSIS','BANK_TO_VERIFY','Bank to Verify'));
  assert.ok(hasEdge(key,'L3_ANALYSIS','VENDOR_TICKET_RAISED','Raise vendor Support Request'));
  assert.ok(hasEdge(key,'L3_ANALYSIS','DEVELOPMENT','Send for Development'));
  assert.ok(hasEdge(key,'L2_ANALYSIS','RESOLVED','Resolve'));
  assert.ok(hasEdge(key,'VERIFICATION_COMPLETE','L2_TEST_FAILED','L2 Test Failure'));
  assert.ok(hasEdge(key,'VERIFICATION_COMPLETE','L3_ANALYSIS','L3 Test Failure'));
  assert.ok(hasEdge(key,'VERIFY_AND_RESOLVE','CLOSED','Close'));
  for (const [from,to] of [
    ['RELEASE','IN_BUILD'],['RELEASE','IN_QUALITY'],['RELEASE','IN_STAGE'],['RELEASE','IN_PREPRODUCTION'],
    ['IN_BUILD','IN_QUALITY'],['IN_BUILD','IN_STAGE'],['IN_BUILD','IN_PREPRODUCTION'],
    ['IN_QUALITY','IN_STAGE'],['IN_QUALITY','IN_PREPRODUCTION'],['IN_STAGE','IN_PREPRODUCTION'],
    ['RESOLVED','IN_BUILD'],['RESOLVED','IN_QUALITY'],['RESOLVED','IN_STAGE'],['RESOLVED','IN_PREPRODUCTION']
  ]) assert.ok(hasEdge(key,from,to), `missing ${from} -> ${to}`);
});

test('client JSM support route is rendered inside Change status and converted to guarded support movement', () => {
  const app = read('apps/web/src/app.js');
  assert.match(app, /portal === 'client' \|\| !item\.supportEffect\?\.targetLevel/);
  assert.match(app, /transitionTargetLevel/);
  assert.match(app, /return handleSupportMove\(req, res, next, portal\)/);
  assert.match(app, /already represented by a JSM-style workflow action is hidden here to avoid duplicate buttons/);
});

test('Problem workflow matches the supplied branch graph including Open -> Completed', () => {
  const key = 'WF_SAAS_PROBLEM';
  assert.equal(edges(key).length, 14);
  for (const [from,to,label] of [
    ['OPEN','UNDER_REVIEW','Review'],['UNDER_REVIEW','UNDER_INVESTIGATION','Investigate'],['PENDING','UNDER_INVESTIGATION','Investigate'],
    ['UNDER_REVIEW','PENDING','Pending'],['UNDER_INVESTIGATION','PENDING','Pending'],['PENDING','UNDER_REVIEW','Back to under review'],
    ['OPEN','COMPLETED','Complete'],['UNDER_INVESTIGATION','COMPLETED','Complete'],['COMPLETED','UNDER_INVESTIGATION','Back to work in progress'],
    ['OPEN','CANCELLED','Cancel'],['UNDER_REVIEW','CANCELLED','Cancel'],['UNDER_INVESTIGATION','CANCELLED','Cancel'],
    ['CANCELLED','CLOSED','Close'],['COMPLETED','CLOSED','Close']
  ]) assert.ok(hasEdge(key,from,to,label), `missing ${from} -> ${to} (${label})`);
});

test('Change Request approval path follows JSM and Management Approved returns to Bank approval, not Development', () => {
  const key='WF_SAAS_CHANGE';
  assert.ok(hasEdge(key,'PRODUCT_REQUIREMENT_GROOMING','CR_FORM','Fill CR Form'));
  assert.ok(hasEdge(key,'CUSTOM_REQUIREMENT_GROOMING','CR_FORM','Fill CR Form'));
  assert.ok(hasEdge(key,'CR_FORM','APPROVAL_BY_BANK','Send for Bank Approval'));
  assert.ok(hasEdge(key,'REQUIREMENT_GROOMING','APPROVAL_BY_BANK','Send for Bank Approval'));
  assert.ok(hasEdge(key,'REQUIREMENT_GROOMING','MANAGEMENT_APPROVAL','Send for Effort and Cost Approval'));
  assert.ok(hasEdge(key,'MANAGEMENT_APPROVED','APPROVAL_BY_BANK','Send for Bank Approval'));
  assert.equal(hasEdge(key,'MANAGEMENT_APPROVED','DEVELOPMENT'), false);
  assert.ok(hasEdge(key,'APPROVED','DEVELOPMENT','Send for Development'));
});

test('Change Request supports JSM test shortcuts, verification failures, incident branch and closure', () => {
  const key='WF_SAAS_CHANGE';
  for (const [from,to] of [
    ['RELEASE','IN_BUILD'],['INCIDENT_CREATED','IN_BUILD'],
    ['RELEASE','IN_QUALITY'],['TEST_PASSED_BUILD','IN_QUALITY'],['INCIDENT_CREATED','IN_QUALITY'],
    ['RELEASE','IN_STAGE'],['TEST_PASSED_BUILD','IN_STAGE'],['TEST_PASSED_QUALITY','IN_STAGE'],['INCIDENT_CREATED','IN_STAGE'],
    ['RELEASE','IN_PREPRODUCTION'],['TEST_PASSED_BUILD','IN_PREPRODUCTION'],['TEST_PASSED_QUALITY','IN_PREPRODUCTION'],['TEST_PASSED_STAGE','IN_PREPRODUCTION'],['INCIDENT_CREATED','IN_PREPRODUCTION']
  ]) assert.ok(hasEdge(key,from,to), `missing ${from} -> ${to}`);
  assert.ok(hasEdge(key,'VERIFICATION_COMPLETE','TEST_FAILED','Test Failure'));
  assert.ok(hasEdge(key,'TEST_FAILED','INCIDENT_CREATED','Create Incident'));
  assert.ok(hasEdge(key,'VERIFICATION_COMPLETE','CLOSED','Close'));
  assert.ok(hasEdge(key,'INCIDENT_CREATED','CLOSED','Close'));
  assert.equal(hasEdge(key,'INCIDENT_CREATED','DEVELOPMENT'), false);
});

test('Maintenance approval/switchback backbone and reports match the supplied JSM deck', () => {
  const key='WF_SAAS_MAINTENANCE';
  for (const [from,to,label] of [
    ['REJECTED','NEW','Reopen Request'],['NEW','ANALYSIS','Start Analysis'],['ANALYSIS','APPROVED','Approve'],['ANALYSIS','REJECTED','Reject'],
    ['APPROVED','SNAPSHOT_REVERT','Snapshot Revert Approval'],['SNAPSHOT_REVERT','COMPLETED','Complete'],
    ['APPROVED','INITIATE_SWITCH_DR','Initiate Switch to DR Site'],['INITIATE_SWITCH_DR','SWITCHED_DR','Switch to DR'],
    ['SWITCHED_DR','INITIATE_REVERSE_PRIMARY','Initiate Reverse Sync To Primary'],['INITIATE_REVERSE_PRIMARY','REVERSE_PRIMARY_ENABLED','Reverse sync To Primary Enabled'],
    ['REVERSE_PRIMARY_ENABLED','PRIMARY_PRECHECK','Switchback To Primary: Pre-check'],['PRIMARY_PRECHECK','APPROVED','Approved'],['PRIMARY_PRECHECK','REJECTED','Rejected'],
    ['APPROVED','INITIATE_SWITCH_PRIMARY','Initiate Switch to Primary'],['INITIATE_SWITCH_PRIMARY','SWITCHED_PRIMARY','Switched to Primary'],
    ['SWITCHED_PRIMARY','INITIATE_REVERSE_DR','Initiate Reverse Sync To DR'],['INITIATE_REVERSE_DR','REVERSE_DR_ENABLED','Reverse sync to DR Enabled'],
    ['REVERSE_DR_ENABLED','BCP_REPORT_PREP','BCP Report Preparation'],['BCP_REPORT_PREP','PUBLISH_BCP_REPORT','Publish BCP Report'],
    ['PUBLISH_BCP_REPORT','CLOSED','Close'],['VA_REPORT','CLOSED','Close'],['PT_REPORT','CLOSED','Close'],['PROBLEM_CREATED','CLOSED','Close']
  ]) assert.ok(hasEdge(key,from,to,label), `missing ${from} -> ${to} (${label})`);
  assert.equal(hasEdge(key,'PUBLISH_BCP_REPORT','COMPLETED'), false);
});

test('Maintenance detours have the documented source and return sets', () => {
  const key='WF_SAAS_MAINTENANCE';
  const incidentSources=['INITIATE_SWITCH_DR','SWITCHED_DR','INITIATE_REVERSE_PRIMARY','INITIATE_SWITCH_PRIMARY','SWITCHED_PRIMARY','INITIATE_REVERSE_DR'];
  const problemSources=['INITIATE_SWITCH_DR','SWITCHED_DR','INITIATE_SWITCH_PRIMARY','SWITCHED_PRIMARY'];
  const serviceSources=['INITIATE_SWITCH_DR','SWITCHED_DR','INITIATE_REVERSE_PRIMARY','PRIMARY_PRECHECK','INITIATE_SWITCH_PRIMARY','SWITCHED_PRIMARY','INITIATE_REVERSE_DR'];
  for (const from of incidentSources) { assert.ok(hasEdge(key,from,'INCIDENT_CREATED')); assert.ok(hasEdge(key,'INCIDENT_CREATED',from)); }
  for (const from of problemSources) { assert.ok(hasEdge(key,from,'PROBLEM_CREATED')); assert.ok(hasEdge(key,'PROBLEM_CREATED',from)); }
  for (const from of serviceSources) { assert.ok(hasEdge(key,from,'SERVICE_REQUEST_CREATED')); assert.ok(hasEdge(key,'SERVICE_REQUEST_CREATED',from)); }
  for (const forbidden of ['REVERSE_PRIMARY_ENABLED','PRIMARY_PRECHECK','REVERSE_DR_ENABLED']) {
    if (forbidden !== 'PRIMARY_PRECHECK') assert.equal(hasEdge(key,forbidden,'SERVICE_REQUEST_CREATED'), false);
    assert.equal(hasEdge(key,forbidden,'INCIDENT_CREATED'), false);
    assert.equal(hasEdge(key,forbidden,'PROBLEM_CREATED'), false);
  }
});

test('release includes safe configuration and existing-request migration scripts', () => {
  const migration = read('scripts/migrate-suntecgroup-to-v24.2.3-workflows.mjs');
  const sync = read('scripts/sync-open-requests-to-v24.2.3-workflows.mjs');
  assert.match(migration, /const V24_VERSION = '24\.2\.3'/);
  assert.match(migration, /DRY RUN is the default/);
  assert.match(sync, /DRY RUN is the default/);
  assert.match(sync, /requests-before-workflow-sync\.json/);
  assert.match(sync, /comments, attachments, timeline, tasks, ownership, SLA clocks/i);
});
