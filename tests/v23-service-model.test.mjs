import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  V23_SAAS_SERVICE_MODEL_KEY,
  ensureMarkerCustomField,
  isV23SaasRequest,
  isV23SaasIncident,
  isV23SaasServiceRequest,
  requestFamilyDisablesSla,
  automaticWorkflowTasksEnabled,
  clientMayChoosePriority,
  clientMayChooseSeverityAtCreate,
  nextStatusForSupportMove,
  recalculateSlaPreservingStart,
  allowedTransitions,
  assertNormalIncidentUntouched
} from '../lib/v23-saas-core.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const workflows = JSON.parse(fs.readFileSync(path.join(root, 'config/v23-saas/workflows.json'), 'utf8')).workflows;
const forms = JSON.parse(fs.readFileSync(path.join(root, 'config/v23-saas/form-definitions.json'), 'utf8')).forms;
const fields = JSON.parse(fs.readFileSync(path.join(root, 'config/v23-saas/field-registry.json'), 'utf8')).fields;

function normalIncident() {
  return {
    level1Type: { code: 'INCIDENT', name: 'Incident' },
    level2Type: { code: 'APPLICATION_INCIDENT', name: 'Application Incident' },
    currentSupportLevel: 'L1',
    currentStatus: { key: 'NEW', name: 'New', statusType: 'start' },
    activeStages: [{ localId: 'L1', currentStatus: { key: 'NEW', name: 'New', statusType: 'start' } }],
    tasks: [{ taskId: '1', status: 'open' }],
    severity: { code: 'S3' },
    priority: { code: 'P3' },
    sla: { state: 'running', startedAt: '2026-09-01T00:00:00.000Z' }
  };
}
function marked(value) {
  return { ...value, customFields: ensureMarkerCustomField(value.customFields || []) };
}

test('normal Incident is NEVER inferred as SaaS by its name', () => {
  const request = normalIncident();
  assert.equal(isV23SaasRequest(request), false);
  assert.equal(isV23SaasIncident(request), false);
  assert.equal(automaticWorkflowTasksEnabled(request), true);
  assert.equal(requestFamilyDisablesSla(request), false);
  assert.equal(clientMayChoosePriority(request), true); // existing normal behavior remains outside v23
});

test('exact marker activates SaaS Incident behavior', () => {
  const request = marked(normalIncident());
  assert.equal(isV23SaasRequest(request), true);
  assert.equal(isV23SaasIncident(request), true);
  assert.equal(automaticWorkflowTasksEnabled(request), false);
  assert.equal(clientMayChoosePriority(request), false);
  assert.equal(clientMayChooseSeverityAtCreate(request), true);
});

test('SaaS Service Request has no SLA and can use subtype workflow', () => {
  const request = marked({
    level1Type: { code: 'SERVICE_REQUEST', name: 'Service Request' },
    level2Type: { code: 'AWS_USER_ACCESS', name: 'AWS User Access' }
  });
  assert.equal(isV23SaasServiceRequest(request), true);
  assert.equal(requestFamilyDisablesSla(request), true);
  const form = forms.find((item) => item.subtype === 'AWS User Access');
  assert.equal(form.workflowKey, 'WF_SAAS_ACCESS_REQUEST');
  assert.equal(form.allowRaisedOnBehalfOf, true);
});

test('client Priority is hidden/non-editable in v23 field registry', () => {
  const priority = fields.find((field) => field.key === 'PRIORITY');
  assert.ok(priority);
  assert.equal(priority.permissions.client.createVisible, false);
  assert.equal(priority.permissions.client.createEditable, false);
  assert.equal(priority.permissions.client.postCreateEditable, false);
  const severity = fields.find((field) => field.key === 'SEVERITY');
  assert.equal(severity.permissions.client.createVisible, true);
  assert.equal(severity.permissions.client.createEditable, true);
  assert.equal(severity.permissions.client.postCreateEditable, false);
});

test('SaaS Incident workflow keeps New creation-only and preserves status on support moves', () => {
  const wf = workflows.find((item) => item.key === 'WF_SAAS_INCIDENT');
  assert.ok(wf);
  assert.equal(wf.newIsCreationOnly, true);
  assert.equal(wf.supportStatusMode, 'SHARED');
  assert.equal(wf.supportMovePolicy, 'PRESERVE_OR_MAP');
  assert.equal(nextStatusForSupportMove(wf, 'ANALYSIS'), 'ANALYSIS');
});

test('Application Incident alone gets Bank to Verify transition', () => {
  const wf = workflows.find((item) => item.key === 'WF_SAAS_INCIDENT');
  const app = allowedTransitions(wf, 'ANALYSIS', { subtype: 'Application Incident', role: 'agent' });
  const infra = allowedTransitions(wf, 'ANALYSIS', { subtype: 'Infrastructure Incident', role: 'agent' });
  assert.ok(app.some((transition) => transition.to === 'BANK_TO_VERIFY'));
  assert.ok(!infra.some((transition) => transition.to === 'BANK_TO_VERIFY'));
});

test('classification recalculation preserves original SLA start', () => {
  const previous = { startedAt: '2026-09-01T01:00:00.000Z', resolutionDueAt: '2026-09-02T01:00:00.000Z' };
  const recalculated = { startedAt: '2026-09-01T05:00:00.000Z', resolutionDueAt: '2026-09-01T13:00:00.000Z' };
  const result = recalculateSlaPreservingStart(previous, recalculated);
  assert.equal(result.startedAt, previous.startedAt);
  assert.equal(result.resolutionDueAt, recalculated.resolutionDueAt);
});

test('normal Incident guard detects accidental mutations', () => {
  const before = normalIncident();
  const same = structuredClone(before);
  assert.equal(assertNormalIncidentUntouched(before, same), true);
  const changed = structuredClone(before);
  changed.currentStatus = { key: 'ANALYSIS' };
  assert.throws(() => assertNormalIncidentUntouched(before, changed), /Normal incident guard failed/);
});

test('all v23 definitions carry exact service model key', () => {
  assert.ok(forms.length > 0);
  assert.ok(workflows.length > 0);
  for (const form of forms) assert.equal(form.serviceModelKey, V23_SAAS_SERVICE_MODEL_KEY);
  for (const workflow of workflows) assert.equal(workflow.serviceModelKey, V23_SAAS_SERVICE_MODEL_KEY);
});


test('creation form engine never activates SaaS by subtype display name alone', () => {
  const candidates = [
    path.join(root, 'templates/v23-saas-form-engine.ejs'),
    path.join(root, 'apps/web/src/views/partials/v23-saas-form-engine.ejs')
  ];
  const file = candidates.find((item) => fs.existsSync(item));
  assert.ok(file, 'v23 SaaS form engine partial is missing');
  const source = fs.readFileSync(file, 'utf8');
  assert.match(source, /fetchExactBinding/);
  assert.match(source, /Failure never falls back to label matching/);
  assert.doesNotMatch(source, /candidates\.includes\(name\)/);
  assert.doesNotMatch(source, /formNames\(form\)/);
});

test('provisioner requires explicit collection:id approval for ambiguous same-name subtypes', () => {
  const source = fs.readFileSync(path.join(root, 'scripts/provision-v23-saas-service-model.mjs'), 'utf8');
  assert.match(source, /--approve-bindings/);
  assert.doesNotMatch(source, /hasSaasEvidence\(doc\) \|\| CONFIRM_CATALOGUE/);
  assert.match(source, /Ambiguous exact-name matches are NEVER bulk-confirmed/);
});
