import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

const webApp = read('apps/web/src/app.js');
const requestApp = read('services/request-service/src/app.js');
const requestModel = read('services/request-service/src/models/ServiceRequest.js');
const requestNew = read('apps/web/src/views/pages/request-new.ejs');
const requestDetail = read('apps/web/src/views/pages/request-detail.ejs');
const home = read('apps/web/src/views/pages/simple-home.ejs');
const css = read('apps/web/src/public/css/app.css');

test('customer SaaS Incident intake hides lifecycle-only fields', () => {
  assert.match(webApp, /V23_INCIDENT_LIFECYCLE_FIELD_KEYS/);
  assert.match(webApp, /filterClientIncidentLifecycleFields/);
  assert.match(requestApp, /V23_INCIDENT_POST_CREATE_FIELD_KEYS/);
  assert.match(requestApp, /customFieldValues = stripV23IncidentPostCreateFields\(customFieldValues\)/);
});

test('v23 service-model marker is persisted and existing requests can be recognized from configured taxonomy', () => {
  assert.match(requestModel, /serviceModelKey:/);
  assert.match(requestApp, /serviceModelKey: String\(req\.body\.serviceModelKey/);
  assert.match(webApp, /configuredSaasRequest/);
  assert.match(webApp, /decoratedRequest\.serviceModelKey = 'SUNTEC_SAAS_V23'/);
});

test('customer users cannot assign or take ownership of support stages', () => {
  assert.match(webApp, /const canTakeOwnership = portal !== 'admin' && portal !== 'client'/);
  assert.match(webApp, /Customer users do not assign or take ownership of support stages/);
  assert.match(webApp, /portal !== 'client' && baseCanAct && actorIsEligibleForStage/);
});

test('SaaS support-level movement preserves workflow progress instead of restarting at New', () => {
  assert.match(requestApp, /function supportMoveTargetStatus/);
  assert.match(requestApp, /currentIsStart/);
  assert.match(requestApp, /preferredIds = \['analysis', 'assigned', 'under_review', 'in_progress'\]/);
  assert.match(requestApp, /supportMoveTargetStatus\(requestItem, currentStage, workflowDefinition, rule\.targetStatusBehavior, forceSaasIncident\)/);
  assert.match(requestApp, /SaaS incidents cannot be moved back to New after work has started/i);
});

test('SaaS Incident task prerequisites are contextual to status transitions rather than generic blocking-task clutter', () => {
  assert.match(requestDetail, /transition-requirements/);
  assert.match(requestDetail, /completeBlockingTaskIds/);
  assert.match(requestDetail, /blockingTaskNote__/);
  assert.match(webApp, /completeBlockingTaskIds/);
  assert.match(webApp, /updateRequestTaskStatus/);
  assert.match(requestDetail, /!isSaasIncident && showWorkflowTasks/);
});

test('acknowledgement is prominent and can be performed from any eligible active support stage', () => {
  assert.match(requestDetail, /acknowledge-priority-card/);
  assert.match(requestDetail, /Acknowledge incident/);
  assert.match(requestDetail, /actorCanWorkAnyStage/);
  assert.match(webApp, /activeAcknowledgeStages\.find/);
  assert.match(webApp, /You are not eligible to acknowledge any active support stage/);
});

test('issue profile custom fields use structured rows and hide customer lifecycle fields', () => {
  assert.match(requestDetail, /visibleCustomFieldValues/);
  assert.match(requestDetail, /customerHiddenLifecycleKeys/);
  assert.match(requestDetail, /rail-custom-field-row/);
  assert.match(css, /\.rail-custom-field-row/);
});

test('desktop incident shell keeps a stable right action rail while the center content scrolls', () => {
  assert.match(css, /\.request-workbench-page\.jira-workbench-v2\{height:100dvh[^}]*overflow:hidden/);
  assert.match(css, /\.jira-issue-main\{height:100%[^}]*overflow-y:auto/);
  assert.match(css, /\.jira-action-rail-v2\{position:relative[^}]*overflow-y:auto/);
});

test('home remains a compact one-screen launchpad with search and quiet operational metrics', () => {
  assert.match(home, /Search issues, clients or requests/i);
  assert.match(home, /Needs my attention/i);
  assert.match(home, /SLA at risk/i);
  assert.match(home, /minimal-home-(top-actions|primary)/);
  assert.match(css, /\.minimal-home-v231(3|4)/);
});

test('Open Escalations only uses breach or explicit escalation events, not routine support movements', () => {
  assert.match(webApp, /explicitlyEscalated/);
  assert.match(webApp, /manual_escalation/);
  const escalationBlock = webApp.slice(webApp.indexOf('const explicitlyEscalated'), webApp.indexOf('const explicitlyEscalated') + 700);
  assert.doesNotMatch(escalationBlock, /support_level_changed/);
});
