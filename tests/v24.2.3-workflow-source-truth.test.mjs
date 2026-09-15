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
const incident = workflows.find((x) => x.key === 'WF_SAAS_INCIDENT');
const transition = (id, from, to, label) => incident.transitions.find((x) => String(x.jiraTransitionId) === String(id) && x.from === from && x.to === to && x.label === label);

test('v24.2.3 is the PPT-faithful workflow correction release', () => {
  const manifest = json('config/v24-saas/service-model.json');
  assert.equal(manifest.version, '24.2.3');
  assert.match(incident.description, /Incident\(4\)\.pptx/);
});

test('normal Bank flow cannot jump from New directly to L2', () => {
  assert.ok(transition(21, 'NEW', 'ANALYSIS', 'Start Analysis'));
  assert.equal(incident.transitions.some((x) => x.from === 'NEW' && x.to === 'L2_SUPPORT'), false);
  assert.equal(incident.transitions.some((x) => x.label === 'Assign to L2'), false);
  const supportPath = paths.find((x) => x.key === 'PATH_INCIDENT_COMMON_V24');
  assert.equal(supportPath.movementRules.some((x) => x.localId === 'assign_l2'), false);
  const requestL2 = supportPath.movementRules.find((x) => x.localId === 'request_l2');
  assert.deepEqual(requestL2.allowedFromStatusIds, ['ANALYSIS','IN_PREPRODUCTION','TEST_FAILED']);
});

test('Analysis menu matches the supplied JSM issue action menu in the same order', () => {
  const actions = incident.transitions.filter((x) => x.from === 'ANALYSIS' && x.clientEnabled === true);
  assert.deepEqual(actions.map((x) => [x.label, x.to]), [
    ['Request to L2 Support','L2_SUPPORT'],
    ['Deferred','DEFERRED'],
    ['Duplicate','DUPLICATE'],
    ['Not an issue','NOT_AN_ISSUE'],
    ['Send to Preproduction','IN_PREPRODUCTION'],
    ['Close','CLOSED'],
    ['On Hold','ON_HOLD'],
    ['Under Monitoring','UNDER_MONITORING']
  ]);
});

test('JSM transition IDs and labels are retained for core Incident paths', () => {
  const expected = [
    [31,'ANALYSIS','IN_PREPRODUCTION','Send to Preproduction'],
    [41,'L2_ANALYSIS','DEFERRED','Deferred'],
    [51,'L3_ANALYSIS','DUPLICATE','Duplicate'],
    [61,'INTERIM_RESOLUTION','NOT_AN_ISSUE','Not an issue'],
    [71,'IN_PREPRODUCTION','TEST_FAILED','Test Failure'],
    [81,'TEST_FAILED','ANALYSIS','Re-Analysis'],
    [91,'L2_TEST_FAILED','CLOSED','Close'],
    [101,'ANALYSIS','L2_SUPPORT','Request to L2 Support'],
    [111,'L2_SUPPORT','L2_ANALYSIS','Start Analysis'],
    [151,'VERIFICATION_COMPLETE','L2_TEST_FAILED','L2 Test Failure'],
    [161,'L2_TEST_FAILED','L2_ANALYSIS','L2 Re-Analysis'],
    [171,'L2_ANALYSIS','L3_SUPPORT','Escalate to L3'],
    [181,'L3_SUPPORT','L3_ANALYSIS','Start Analysis'],
    [191,'L3_ANALYSIS','RESOLVED','Resolve'],
    [201,'L3_ANALYSIS','DEVELOPMENT','Send for Development'],
    [211,'DEVELOPMENT','RELEASE','Send for Release'],
    [221,'RELEASE','IN_BUILD','Send for Build'],
    [281,'L2_TEST_FAILED','PROBLEM_CREATED','Create Problem'],
    [341,'RESOLVED','VERIFICATION_COMPLETE','Verification complete by Automation'],
    [361,'L3_ANALYSIS','VENDOR_TICKET_RAISED','Raise vendor Support Request'],
    [371,'L2_ANALYSIS','RESOLVED','Resolve'],
    [381,'RESOLVED','IN_BUILD','Send to build'],
    [461,'L2_ANALYSIS','INTERIM_RESOLUTION','Interim Resolution'],
    [531,'DEFERRED','ANALYSIS','Analysis'],
    [541,'DEFERRED','L3_ANALYSIS','L3 Analysis'],
    [551,'DEFERRED','L2_ANALYSIS','L2 Analysis'],
    [561,'DEFERRED','INTERIM_RESOLUTION','Interim Resolution'],
    [571,'L2_ANALYSIS','BANK_TO_VERIFY','Bank to Verify'],
    [581,'L3_ANALYSIS','BANK_TO_VERIFY','Bank to Verify'],
    [591,'BANK_TO_VERIFY','L2_ANALYSIS','L2 Analysis'],
    [601,'BANK_TO_VERIFY','L3_ANALYSIS','L3 Analysis'],
    [611,'ANALYSIS','UNDER_MONITORING','Under Monitoring'],
    [621,'UNDER_MONITORING','ANALYSIS','Analysis'],
    [631,'UNDER_MONITORING','L3_ANALYSIS','L3 Analysis'],
    [641,'UNDER_MONITORING','L2_ANALYSIS','L2 Analysis'],
    [651,'UNDER_MONITORING','INTERIM_RESOLUTION','Interim Resolution'],
    [661,'ANALYSIS','ON_HOLD','On Hold'],
    [671,'ON_HOLD','ANALYSIS','Analysis'],
    [681,'ON_HOLD','L2_ANALYSIS','L2 Analysis'],
    [691,'ON_HOLD','L3_ANALYSIS','L3 Analysis'],
    [701,'ON_HOLD','INTERIM_RESOLUTION','Interim Resolution']
  ];
  for (const [id,from,to,label] of expected) assert.ok(transition(id,from,to,label), `missing Jira ${id}: ${from} -> ${to} (${label})`);
});

test('same source/target JSM actions remain distinct instead of being collapsed', () => {
  const preprodVerify = incident.transitions.filter((x) => x.from === 'IN_PREPRODUCTION' && x.to === 'VERIFICATION_COMPLETE');
  assert.deepEqual(new Set(preprodVerify.map((x) => x.jiraTransitionId)), new Set(['11','431','511']));
  assert.deepEqual(new Set(preprodVerify.map((x) => x.label)), new Set(['Deploy to Production/DR','L2 Deploy to Production/DR','Send to Production/DR']));
  const verifyResolve = incident.transitions.filter((x) => x.from === 'VERIFICATION_COMPLETE' && x.to === 'VERIFY_AND_RESOLVE');
  assert.deepEqual(new Set(verifyResolve.map((x) => x.jiraTransitionId)), new Set(['351','521']));
});

test('Jira portal-customer metadata is not confused with Bank/L1 operator permission', () => {
  const onHold = transition(661,'ANALYSIS','ON_HOLD','On Hold');
  const monitoring = transition(611,'ANALYSIS','UNDER_MONITORING','Under Monitoring');
  assert.equal(onHold.jiraCustomerEnabled, false);
  assert.equal(onHold.clientEnabled, true);
  assert.equal(monitoring.jiraCustomerEnabled, false);
  assert.equal(monitoring.clientEnabled, true);
});

test('status form submits exact transition identity and backend matches it', () => {
  const ejs = read('apps/web/src/views/pages/request-detail.ejs');
  const web = read('apps/web/src/app.js');
  const service = read('services/request-service/src/app.js');
  assert.match(ejs, /name="transitionKey"/);
  assert.match(ejs, /data-transition-key="<%= action\.localId/);
  assert.match(web, /requestedTransitionKey/);
  assert.match(web, /transitionKey: selectedTransition\?\.localId/);
  assert.match(service, /const transitionKey = String\(req\.body\.transitionKey/);
  assert.match(service, /String\(item\.localId \|\| ''\).*=== transitionKey/s);
});


test('legacy open-request snapshots keep customer actions until the v24.2.3 sync is applied', () => {
  const service = read('services/request-service/src/app.js');
  assert.match(service, /clientEnabled: item\.clientEnabled !== undefined \? item\.clientEnabled === true : item\.customerEnabled === true/);
  assert.match(service, /jiraCustomerEnabled: item\.jiraCustomerEnabled !== undefined \? item\.jiraCustomerEnabled === true : item\.customerEnabled === true/);
});

test('Problem, Change and Maintenance source graphs remain present after the Incident correction', () => {
  const problem = workflows.find((x) => x.key === 'WF_SAAS_PROBLEM');
  const change = workflows.find((x) => x.key === 'WF_SAAS_CHANGE');
  const maintenance = workflows.find((x) => x.key === 'WF_SAAS_MAINTENANCE');
  assert.equal(problem.transitions.length, 14);
  assert.ok(change.transitions.some((x) => x.from === 'MANAGEMENT_APPROVED' && x.to === 'APPROVAL_BY_BANK' && x.label === 'Send for Bank Approval'));
  assert.ok(maintenance.transitions.some((x) => x.from === 'REVERSE_DR_ENABLED' && x.to === 'BCP_REPORT_PREP' && x.label === 'BCP Report Preparation'));
});
