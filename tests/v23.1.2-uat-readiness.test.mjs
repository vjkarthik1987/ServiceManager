import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

const webApp = read('apps/web/src/app.js');
const apiClient = read('apps/web/src/services/apiClient.js');
const requestApp = read('services/request-service/src/app.js');
const clientModel = read('services/organization-service/src/models/Client.js');
const formEngine = read('apps/web/src/views/partials/v23-saas-form-engine.ejs');
const requestDetail = read('apps/web/src/views/pages/request-detail.ejs');
const landing = read('apps/web/src/views/pages/landing.ejs');
const home = read('apps/web/src/views/pages/simple-home.ejs');
const loading = read('apps/web/src/views/pages/workspace-loading.ejs');
const sidebar = read('apps/web/src/views/partials/sidebar.ejs');
const supportSeed = read('scripts/seed-uat-support-model.mjs');
const masterSeed = read('scripts/seed-uat-master-data.mjs');

test('root has a dedicated landing page and established workspaces do not default to setup', () => {
  assert.match(webApp, /render\(['"]pages\/landing['"]/);
  assert.match(landing, /Sign in/i);
  assert.match(landing, /Service orchestration/i);
});

test('login uses a subtle workspace setup transition before home', () => {
  assert.match(webApp, /\/session\/welcome/);
  assert.match(webApp, /pages\/workspace-loading/);
  assert.match(loading, /Setting up your workspace/i);
});

test('home is search-led and retains quiet operational summaries', () => {
  assert.match(home, /Search issues, clients (?:or|,) requests/i);
  assert.match(home, /My attention/i);
  assert.match(home, /SLA at risk/i);
  assert.match(home, /Recent/i);
});

test('clients have timezone-aware business calendar configuration and UAT banks are seeded', () => {
  assert.match(clientModel, /businessCalendarMode/);
  assert.match(clientModel, /workingDays/);
  assert.match(masterSeed, /Africa\/Johannesburg/);
  assert.match(masterSeed, /Europe\/Copenhagen/);
  assert.match(masterSeed, /STDBNK/);
  assert.match(masterSeed, /DANSKE/);
});

test('SaaS Incident creation hides lifecycle fields and server strips them if submitted anyway', () => {
  assert.match(formEngine, /RELEASE_ID|RCA_CATEGORY|ROOT_CAUSE/);
  assert.match(requestApp, /V23_INCIDENT_POST_CREATE_FIELD_KEYS/);
  assert.match(requestApp, /stripV23IncidentPostCreateFields/);
  assert.match(formEngine, /PORTAL === 'client'/);
});

test('SaaS incident page removes legacy ownership and task clutter for customers', () => {
  assert.match(requestDetail, /isV23Saas/);
  assert.match(webApp, /v23SaasRequest && !isAssigned && actorIsEligibleForStage/);
  assert.match(requestDetail, /portal !== 'client'/);
  assert.doesNotMatch(sidebar, />My Tasks<\/a>/);
  assert.doesNotMatch(sidebar, />Team Tasks<\/a>/);
});

test('SLA notifier exposes at-risk and breach candidates', () => {
  assert.match(requestApp, /sla-notification-candidates/);
  assert.match(apiClient, /sla-notification-candidates/);
  assert.match(requestApp, /0\.75/);
});

test('seeded Incident workflows retain only accountable task templates', () => {
  assert.match(supportSeed, /ESSENTIAL_INCIDENT_TASK_PATTERN/);
  assert.match(supportSeed, /trimIncidentStatusTasks/);
});
