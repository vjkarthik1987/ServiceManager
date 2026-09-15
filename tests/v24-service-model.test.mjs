import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  V24_SAAS_SERVICE_MODEL_KEY,
  isV24SaasRequest,
  isV24SaasIncident,
  allowedTransitions,
  recalculateSlaPreservingStart
} from '../lib/v24-saas-core.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const json = (file) => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

const manifest = json('config/v24-saas/service-model.json');
const fields = json('config/v24-saas/field-registry.json');
const forms = json('config/v24-saas/form-definitions.json');
const workflows = json('config/v24-saas/workflows.json');
const paths = json('config/v24-saas/support-paths.json');
const bindings = json('config/v24-saas/subtype-workflow-map.json');
const incidentWorkflow = workflows.workflows.find((item) => item.key === 'WF_SAAS_INCIDENT');
const incidentPath = paths.supportPaths.find((item) => item.key === 'PATH_INCIDENT_COMMON_V24');

const incidentForms = forms.forms.filter((item) => item.family === 'INCIDENT');

function transition(key) {
  return incidentWorkflow.transitions.find((item) => item.key === key);
}

function movement(key) {
  return incidentPath.movementRules.find((item) => item.localId === key);
}

test('v24 taxonomy keeps Request -> six issue types -> four Incident subtypes', () => {
  assert.equal(manifest.key, V24_SAAS_SERVICE_MODEL_KEY);
  assert.equal(manifest.taxonomy.family, 'Request');
  assert.deepEqual(manifest.taxonomy.issueTypes, ['Incident','Service Request','Maintenance Request','Problem','Change Request','Query']);
  assert.deepEqual(manifest.taxonomy.incidentSubtypes, ['Application','Security','Infrastructure','Operational']);
  assert.equal(manifest.taxonomy.furtherClassification, 'form_field_not_taxonomy_level');
});

test('Incident SLA is attached at Issue Type and inherited by all Incident subtypes', () => {
  assert.equal(manifest.sla.incident.attachedAt, 'ISSUE_TYPE:INCIDENT');
  assert.equal(manifest.sla.incident.inheritToSubtypes, true);
  assert.equal(manifest.sla.incident.eligibility, 'incident_level_bank_or_raised_for_bank');
  assert.equal(manifest.sla.incident.continuesAcrossSupportLevels, true);
  for (const binding of bindings.bindings.filter((item) => item.family === 'INCIDENT')) {
    assert.equal(binding.inheritSlaFromIssueType, true);
  }
});

test('four Incident subtypes use separate forms and the common JSM-aligned workflow', () => {
  assert.equal(incidentForms.length, 4);
  const expected = new Map([
    ['Application Incident','SAAS_INCIDENT_APPLICATION'],
    ['Security Incident','SAAS_INCIDENT_SECURITY'],
    ['Infrastructure Incident','SAAS_INCIDENT_INFRASTRUCTURE'],
    ['Operational Incident','SAAS_INCIDENT_OPERATIONAL']
  ]);
  for (const [subtype, key] of expected) {
    const form = incidentForms.find((item) => item.subtype === subtype);
    assert.ok(form, `missing ${subtype}`);
    assert.equal(form.key, key);
    assert.equal(form.workflowKey, 'WF_SAAS_INCIDENT');
    const keys = form.fields.map((item) => item.key);
    assert.ok(keys.includes('INCIDENT_FURTHER_CLASSIFICATION'));
    assert.ok(keys.includes('S3_BUCKET_URL'));
    assert.ok(keys.includes('SEVERITY'));
    assert.ok(keys.includes('RAISED_ENVIRONMENT'));
    assert.ok(!keys.includes('RCA_CATEGORY'));
    assert.ok(!keys.includes('ROOT_CAUSE'));
    assert.ok(!keys.includes('RELEASE_ID'));
  }
});

test('Security Incident adds Client Data Involved while other Incident forms do not', () => {
  const security = incidentForms.find((item) => item.key === 'SAAS_INCIDENT_SECURITY');
  assert.ok(security.fields.some((item) => item.key === 'CLIENT_DATA_INVOLVED'));
  for (const form of incidentForms.filter((item) => item.key !== 'SAAS_INCIDENT_SECURITY')) {
    assert.ok(!form.fields.some((item) => item.key === 'CLIENT_DATA_INVOLVED'));
  }
});

test('Further Classification is a configured LOV on each Incident form', () => {
  for (const form of incidentForms) {
    const field = form.fields.find((item) => item.key === 'INCIDENT_FURTHER_CLASSIFICATION');
    assert.ok(Array.isArray(field.options));
    assert.ok(field.options.length >= 5);
  }
  const app = incidentForms.find((item) => item.key === 'SAAS_INCIDENT_APPLICATION');
  assert.ok(app.fields.find((item) => item.key === 'INCIDENT_FURTHER_CLASSIFICATION').options.some((item) => item.value === 'UI Issues'));
  const infra = incidentForms.find((item) => item.key === 'SAAS_INCIDENT_INFRASTRUCTURE');
  assert.ok(infra.fields.find((item) => item.key === 'INCIDENT_FURTHER_CLASSIFICATION').options.some((item) => item.value === 'RDS Down'));
  const operational = incidentForms.find((item) => item.key === 'SAAS_INCIDENT_OPERATIONAL');
  assert.ok(operational.fields.find((item) => item.key === 'INCIDENT_FURTHER_CLASSIFICATION').options.some((item) => item.value === 'DR issues'));
});

test('Incident workflow contains the supplied JSM support, development, verification and exception states', () => {
  const keys = new Set(incidentWorkflow.statuses.map((item) => item.key));
  for (const key of [
    'NEW','ANALYSIS','L2_SUPPORT','L2_ANALYSIS','L3_SUPPORT','L3_ANALYSIS',
    'DEVELOPMENT','RELEASE','IN_BUILD','IN_QUALITY','IN_STAGE','IN_PREPRODUCTION',
    'VERIFICATION_COMPLETE','VERIFY_AND_RESOLVE','BANK_TO_VERIFY','RESOLVED','CLOSED',
    'UNDER_MONITORING','ON_HOLD','INTERIM_RESOLUTION','TEST_FAILED','L2_TEST_FAILED',
    'VENDOR_TICKET_RAISED','DEFERRED','DUPLICATE','NOT_AN_ISSUE','PROBLEM_CREATED'
  ]) assert.ok(keys.has(key), `missing workflow state ${key}`);
});

test('customer and support routing transitions mirror the live Jira workflow permissions', () => {
  assert.equal(transition('JSM_21_NEW').clientEnabled, true);
  assert.equal(transition('JIRA_101_NEW').clientEnabled, true);
  assert.deepEqual(transition('JIRA_101_NEW').condition.originSupportLevels, ['L1']);
  assert.equal(transition('JSM_451_NEW').clientEnabled, false);
  assert.equal(manifest.routing.clientDirectL3, false);

  assert.equal(movement('request_l2').customerEnabled, true);
  assert.equal(movement('request_l2').targetStatusId, 'L2_SUPPORT');
  assert.equal(movement('assign_l2'), undefined);
  assert.equal(movement('assign_l3'), undefined);
  assert.equal(movement('escalate_l3').targetStatusId, 'L3_SUPPORT');
});

test('customer Request to L2 uses the exact live Jira source-state set', () => {
  assert.deepEqual(movement('request_l2').allowedFromStatusIds, ['NEW','ANALYSIS','IN_PREPRODUCTION','TEST_FAILED']);
});

test('L2 and L3 support have the exact JSM Start Analysis transitions', () => {
  assert.deepEqual([transition('JSM_111_L2_SUPPORT').from, transition('JSM_111_L2_SUPPORT').to], ['L2_SUPPORT','L2_ANALYSIS']);
  assert.deepEqual([transition('JSM_181_L3_SUPPORT').from, transition('JSM_181_L3_SUPPORT').to], ['L3_SUPPORT','L3_ANALYSIS']);
});

test('management escalation is status-preserving and only Support Manager is customer-enabled', () => {
  const actions = new Map(incidentWorkflow.globalActions.map((item) => [String(item.jiraTransitionId), item]));
  assert.equal(actions.get('471').statusEffect, 'KEEP');
  assert.equal(actions.get('471').customerEnabled, true);
  assert.equal(actions.get('481').customerEnabled, false);
  assert.equal(actions.get('491').customerEnabled, false);
});

test('v24 helper recognises explicit v24 marker only and preserves SLA start on recalculation', () => {
  const request = {
    serviceModelKey: 'SUNTEC_SAAS_V24',
    level2Type: { name: 'Incident', code: 'INCIDENT' }
  };
  assert.equal(isV24SaasRequest(request), true);
  assert.equal(isV24SaasIncident(request), true);
  assert.equal(isV24SaasRequest({ level2Type: { name: 'Incident' } }), false);
  const previous = { startedAt: '2026-09-10T10:00:00.000Z' };
  assert.equal(recalculateSlaPreservingStart(previous, { state: 'running' }).startedAt, previous.startedAt);
});

test('allowedTransitions enforces corrected client/role workflow metadata', () => {
  const client = allowedTransitions(incidentWorkflow, 'NEW', { role: 'client', subtype: 'Application Incident' });
  assert.ok(client.some((item) => item.key === 'JSM_21_NEW'));
  assert.ok(!client.some((item) => item.key === 'JSM_101_NEW'));
  assert.ok(!client.some((item) => item.key === 'JSM_451_NEW'));
});

test('runtime stores v24 dynamic fields and preserves Severity/S3 while stripping lifecycle fields', () => {
  const web = read('apps/web/src/app.js');
  const requestApp = read('services/request-service/src/app.js');
  const formEngine = read('apps/web/src/views/partials/v23-saas-form-engine.ejs');
  assert.match(web, /v24Field__/);
  assert.match(requestApp, /V24_MARKER_FIELD_KEY/);
  assert.match(requestApp, /v24 Incident intake keeps reported Severity and S3 evidence/i);
  assert.doesNotMatch(read('apps/web/src/app.js').match(/const V23_INCIDENT_LIFECYCLE_FIELD_KEYS = new Set\(\[[\s\S]*?\]\);/)?.[0] || '', /S3_BUCKET_URL/);
  assert.match(formEngine, /for \(const version of \['v24', 'v23'\]\)/);
  assert.match(formEngine, /Product\/Module\/Region are not part of the/);
});

test('cross-level routing and global escalation are separate from source-stage ownership', () => {
  const web = read('apps/web/src/app.js');
  assert.match(web, /configuredCrossLevelRoute/);
  assert.match(web, /configured routing action is not the same thing as owning the source stage/i);
  assert.match(web, /management escalations are request-level self-transitions/i);
});
