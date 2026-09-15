import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const json = (file) => JSON.parse(read(file));
const workflowsDoc = json('config/v24-saas/workflows.json');
const workflows = workflowsDoc.workflows;
const supportPaths = json('config/v24-saas/support-paths.json').supportPaths;

const CASES = [
  ['INCIDENT', 'WF_SAAS_INCIDENT', 'incident.full.json', 27, 58, 100, 3, 'bad910f08e43fed7ae23fb6db2ea7e530d429334d4c91bb2606c72beaf082497'],
  ['CHANGE', 'WF_SAAS_CHANGE', 'change.full.json', 29, 35, 54, 1, '6d843f9a09157fce6b33115c3139143e8a36a56bc457f594676add4807b993e5'],
  ['PROBLEM', 'WF_SAAS_PROBLEM', 'problem.full.json', 7, 9, 14, 0, 'f8fc616510f07e7a992b89b4ddf22a473cb5ce61664550213aee0b113a16402f'],
  ['MAINTENANCE', 'WF_SAAS_MAINTENANCE', 'maintenance.full.json', 24, 56, 69, 0, 'd4ffafde97084a3a7239bac021114166c1764dbff8cc2371b365f0b58434e22e']
];

function wf(key) { return workflows.find((item) => item.key === key); }
function source(file) { return json(`config/v24-saas/jira-source/${file}`); }
function edge(key, jiraId, from, to) {
  return wf(key).transitions.find((item) => String(item.jiraTransitionId) === String(jiraId) && item.from === from && item.to === to);
}
function status(key, localId) { return wf(key).statuses.find((item) => item.key === localId); }

function expectedDirectedEdges(sourceDoc, configWorkflow) {
  const localByJira = new Map(configWorkflow.statuses.map((item) => [String(item.jiraStatusId), item.key]));
  const output = [];
  for (const transition of sourceDoc.transitions || []) {
    if (transition.type !== 'DIRECTED') continue;
    const toId = String(transition.to?.id || transition.raw?.toStatusReference || '');
    const to = localByJira.get(toId);
    for (const fromRef of transition.from || []) {
      if (!fromRef || typeof fromRef === 'string') continue;
      output.push(`${transition.id}|${localByJira.get(String(fromRef.id))}|${to}|${String(transition.name || '').trim()}`);
    }
  }
  return output.sort();
}

function actualDirectedEdges(configWorkflow) {
  return (configWorkflow.transitions || [])
    .map((transition) => `${transition.jiraTransitionId}|${transition.from}|${transition.to}|${transition.label}`)
    .sort();
}

test('v25.0.0 declares live Jira REST exports as workflow authority', () => {
  const manifest = json('config/v24-saas/service-model.json');
  assert.equal(manifest.version, '25.0.0');
  assert.match(String(manifest.ui?.workflowAlignment || ''), /Live Jira REST workflow exports/i);
  assert.equal(workflowsDoc.source?.release, '25.0.0');
  assert.equal(workflowsDoc.source?.serviceRequestDeferred, true);
});

for (const [family, key, file, statusCount, sourceObjects, edgeCount, globalCount, sha] of CASES) {
  test(`${family}: generated workflow is an exact graph projection of the Jira snapshot`, () => {
    const sourceDoc = source(file);
    const configWorkflow = wf(key);
    assert.ok(configWorkflow, `missing ${key}`);
    assert.equal(sourceDoc.exportMetadata.workflowSha256, sha);
    assert.equal(configWorkflow.jiraSource.sha256, sha);
    assert.equal(configWorkflow.jiraSource.workflowId, sourceDoc.identity.id);
    assert.equal(configWorkflow.jiraSource.versionNumber, sourceDoc.identity.version.versionNumber);
    assert.equal(configWorkflow.statuses.length, statusCount);
    assert.equal(sourceDoc.statistics.statusCount, statusCount);
    assert.equal(sourceDoc.statistics.transitionCount, sourceObjects);
    assert.equal(configWorkflow.jiraSource.sourceTransitionObjectCount, sourceObjects);
    assert.equal(configWorkflow.transitions.length, edgeCount);
    assert.equal(configWorkflow.globalActions.length, globalCount);
    assert.deepEqual(actualDirectedEdges(configWorkflow), expectedDirectedEdges(sourceDoc, configWorkflow));

    const expectedGlobals = (sourceDoc.transitions || [])
      .filter((item) => item.type === 'GLOBAL')
      .map((item) => `${item.id}|${String(item.name || '').trim()}`)
      .sort();
    const actualGlobals = (configWorkflow.globalActions || [])
      .map((item) => `${item.jiraTransitionId}|${item.label}`)
      .sort();
    assert.deepEqual(actualGlobals, expectedGlobals);

    const sourceStatuses = (sourceDoc.statuses || [])
      .map((item) => `${item.baseStatus?.id || item.fullStatus?.id}|${item.baseStatus?.name || item.fullStatus?.name}`)
      .sort();
    const configStatuses = (configWorkflow.statuses || [])
      .map((item) => `${item.jiraStatusId}|${item.name}`)
      .sort();
    assert.deepEqual(configStatuses, sourceStatuses);
  });
}

test('Incident routing and return-state conditions are source-derived', () => {
  const incident = wf('WF_SAAS_INCIDENT');
  const requestL2 = incident.transitions.filter((item) => String(item.jiraTransitionId) === '101');
  assert.deepEqual([...new Set(requestL2.map((item) => item.from))], ['NEW', 'ANALYSIS', 'IN_PREPRODUCTION', 'TEST_FAILED']);
  assert.ok(requestL2.every((item) => item.to === 'L2_SUPPORT'));
  assert.ok(requestL2.every((item) => item.supportEffect?.targetLevel === 'L2'));
  assert.ok(requestL2.every((item) => item.allowedSupportLevels.includes('L1')));

  const escalateL3 = incident.transitions.filter((item) => String(item.jiraTransitionId) === '171');
  assert.deepEqual([...new Set(escalateL3.map((item) => item.from))], ['L2_ANALYSIS', 'IN_BUILD', 'IN_QUALITY', 'IN_STAGE', 'INTERIM_RESOLUTION']);
  assert.ok(escalateL3.every((item) => item.to === 'L3_SUPPORT'));
  assert.ok(escalateL3.every((item) => item.supportEffect?.targetLevel === 'L3'));

  const deferredToAnalysis = edge('WF_SAAS_INCIDENT', '531', 'DEFERRED', 'ANALYSIS');
  assert.deepEqual(deferredToAnalysis.condition.previousStatusIds, ['ANALYSIS']);
  const holdToL3 = wf('WF_SAAS_INCIDENT').transitions.find((item) => item.from === 'ON_HOLD' && item.to === 'L3_ANALYSIS');
  assert.ok(holdToL3?.condition?.previousStatusIds?.includes('L3_ANALYSIS'));

  const path = supportPaths.find((item) => item.key === 'PATH_INCIDENT_COMMON_V24');
  const l2 = path.movementRules.find((item) => item.localId === 'request_l2');
  const l3 = path.movementRules.find((item) => item.localId === 'escalate_l3');
  assert.deepEqual(l2.allowedFromStatusIds, ['NEW', 'ANALYSIS', 'IN_PREPRODUCTION', 'TEST_FAILED']);
  assert.deepEqual(l3.allowedFromStatusIds, ['L2_ANALYSIS', 'IN_BUILD', 'IN_QUALITY', 'IN_STAGE', 'INTERIM_RESOLUTION']);
  assert.equal(path.movementRules.some((item) => item.localId === 'assign_l3'), false);
});

test('source validators, screens and mandatory transition fields are retained', () => {
  const verifyResolve = edge('WF_SAAS_INCIDENT', '351', 'VERIFICATION_COMPLETE', 'VERIFY_AND_RESOLVE');
  assert.deepEqual(verifyResolve.requiredFields.map((f) => f.key), ['ROOT_CAUSE']);
  assert.ok(verifyResolve.transitionScreenId);
  assert.ok(verifyResolve.jiraRules?.validators?.length);

  const l2Resolve = edge('WF_SAAS_INCIDENT', '371', 'L2_ANALYSIS', 'RESOLVED');
  for (const key of ['COMMENT', 'RESOLUTION', 'ROOT_CAUSE', 'CORRECTIVE_ACTION', 'PREVENTIVE_ACTION', 'RCA_CATEGORY']) {
    assert.ok(l2Resolve.requiredFields.some((f) => f.key === key), `Incident Resolve missing ${key}`);
  }

  const changeStart = edge('WF_SAAS_CHANGE', '11', 'NEW', 'ANALYSIS');
  for (const key of ['REQUIREMENT_DOCUMENT_LINK', 'ASSIGNEE', 'COMMENT']) assert.ok(changeStart.requiredFields.some((f) => f.key === key));
  const deploy = edge('WF_SAAS_CHANGE', '91', 'TEST_PASSED_PREPRODUCTION', 'VERIFICATION_COMPLETE');
  assert.ok(deploy.requiredFields.some((f) => f.key === 'TEST_CASE_LINK'));
  const switchDr = edge('WF_SAAS_MAINTENANCE', '251', 'INITIATE_SWITCH_DR', 'SWITCHED_DR');
  assert.ok(switchDr.requiredFields.some((f) => f.key === 'DR_RTO_MINUTES'));
  const problemCancel = edge('WF_SAAS_PROBLEM', '101', 'OPEN', 'CANCELLED');
  assert.ok(problemCancel.requiredFields.some((f) => f.key === 'RELEASE_ID'));
});

test('Jira approval configuration is retained on approval states', () => {
  const bank = status('WF_SAAS_CHANGE', 'APPROVAL_BY_BANK').approvalConfiguration;
  assert.equal(bank.active, 'true');
  assert.equal(bank.transitionApproved, '31');
  assert.equal(bank.transitionRejected, '261');

  const management = status('WF_SAAS_CHANGE', 'MANAGEMENT_APPROVAL').approvalConfiguration;
  assert.equal(management.active, 'true');
  assert.equal(management.transitionApproved, '281');
  assert.equal(management.transitionRejected, '261');

  const maintenance = status('WF_SAAS_MAINTENANCE', 'ANALYSIS').approvalConfiguration;
  assert.equal(maintenance.active, 'true');
  assert.equal(maintenance.transitionApproved, '41');
  assert.equal(maintenance.transitionRejected, '11');
});

test('same Jira source/target actions are preserved as distinct transitions', () => {
  const candidates = wf('WF_SAAS_INCIDENT').transitions.filter((item) => item.from === 'IN_PREPRODUCTION' && item.to === 'VERIFICATION_COMPLETE');
  assert.deepEqual(new Set(candidates.map((item) => item.jiraTransitionId)), new Set(['11', '431', '511']));
  const verifyResolve = wf('WF_SAAS_INCIDENT').transitions.filter((item) => item.from === 'VERIFICATION_COMPLETE' && item.to === 'VERIFY_AND_RESOLVE');
  assert.deepEqual(new Set(verifyResolve.map((item) => item.jiraTransitionId)), new Set(['351', '521']));
});

test('runtime carries Jira metadata, conditions, previous-state rules and transition fields', () => {
  const requestService = read('services/request-service/src/app.js');
  const web = read('apps/web/src/app.js');
  const view = read('apps/web/src/views/pages/request-detail.ejs');
  const workflowModel = read('services/organization-service/src/models/Workflow.js');
  const requestModel = read('services/request-service/src/models/ServiceRequest.js');
  assert.match(requestService, /transitionConditionAllowed/);
  assert.match(requestService, /previousStatusId/);
  assert.match(requestService, /missingRequiredTransitionFields/);
  assert.match(requestService, /transitionFieldValues/);
  assert.match(web, /workflowConditionAllowedForUi/);
  assert.match(web, /originSupportLevel: currentSupportLevel/);
  assert.match(web, /originTargetStatusId/);
  assert.match(web, /'L2_SUPPORT'/);
  assert.match(web, /'L3_SUPPORT'/);
  assert.match(web, /transitionFieldValues/);
  assert.match(view, /data-transition-fields-group/);
  assert.match(view, /workflowField__/);
  assert.match(workflowModel, /sourceMetadata/);
  assert.match(requestModel, /originSupportLevel/);
});

test('release has dry-run/apply migration and open-request sync for v25.0.0', () => {
  const migration = read('scripts/migrate-suntecgroup-to-v25-jira-workflows.mjs');
  const sync = read('scripts/sync-open-requests-to-v25-workflows.mjs');
  assert.match(migration, /const V25_VERSION = '25\.0\.0'/);
  assert.match(migration, /sourceMetadata/);
  assert.match(migration, /DRY RUN is the default/);
  assert.match(sync, /const VERSION = '25\.0\.0'/);
  assert.match(sync, /originSupportLevel/);
  assert.match(sync, /previousStatusId/);
  assert.match(sync, /requests-before-workflow-sync\.json/);
});
