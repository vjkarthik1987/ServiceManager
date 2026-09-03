import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

const webApp = read('apps/web/src/app.js');
const requestApp = read('services/request-service/src/app.js');
const requestNew = read('apps/web/src/views/pages/request-new.ejs');
const requestDetail = read('apps/web/src/views/pages/request-detail.ejs');
const home = read('apps/web/src/views/pages/simple-home.ejs');
const css = read('apps/web/src/public/css/app.css');
const supportSeed = read('scripts/seed-uat-support-model.mjs');

test('seeded Incident taxonomy is recognized even when legacy form binding metadata is missing', () => {
  assert.match(webApp, /function taxonomyNodeIsIncident/);
  assert.match(webApp, /function requestLooksLikeV23Incident/);
  assert.match(webApp, /taxonomyVersion\.startsWith\('23\.1'\)/);
  assert.match(requestApp, /function isSeededV23IncidentPayload/);
  assert.match(requestApp, /__seededV23Incident = isSeededV23IncidentPayload\(req\.body\)/);
});

test('customer Incident intake filters lifecycle fields by taxonomy, not only formDefinitionKey', () => {
  assert.match(webApp, /const isSaasIncidentIntake = taxonomyNodeIsIncident\(selectedLevel2/);
  assert.match(webApp, /incident: isSaasIncidentIntake/);
  assert.match(webApp, /V23_INCIDENT_LIFECYCLE_FIELD_KEYS/);
  assert.match(requestNew, /portal === 'client' && isSaasIncidentIntake/);
  assert.match(requestApp, /stripV23IncidentPostCreateFields/);
});

test('UAT seed writes explicit SaaS Incident form markers for the four Incident subtypes', () => {
  for (const key of ['SAAS_INCIDENT_APPLICATION','SAAS_INCIDENT_SECURITY','SAAS_INCIDENT_INFRASTRUCTURE','SAAS_INCIDENT_OPERATIONAL']) {
    assert.match(supportSeed, new RegExp(key));
  }
  assert.match(supportSeed, /node\.formDefinitionKey = String\(formDefinitionKey/);
});

test('client-owned SaaS L1 stages do not require an individual owner to change status', () => {
  assert.match(webApp, /clientScopedSaasStage = v23SaasRequest && portal === 'client' && stage\?\.ownerSide === 'client'/);
  assert.match(requestApp, /organizationalClientOwnership = effectiveSaasIncident && stage\.ownerSide === 'client'/);
  assert.match(requestApp, /&& !organizationalClientOwnership/);
});

test('client-owned SaaS L1 stages can route forward while unassigned', () => {
  assert.match(webApp, /clientScopedSaasStage = v23SaasRequest && portal === 'client' && sourceStage\?\.ownerSide === 'client'/);
  assert.match(webApp, /!canAutoRouteSaasStage && !clientScopedSaasStage/);
  assert.match(requestApp, /supportMoveTargetStatus\(requestItem, currentStage, workflowDefinition, rule\.targetStatusBehavior, forceSaasIncident\)/);
});

test('existing seeded Incident records are treated as SaaS on detail pages without relying on stored marker', () => {
  assert.match(requestDetail, /level2IncidentCode/);
  assert.match(requestDetail, /seededV23Incident/);
  assert.match(requestDetail, /const isV23Saas = v23ServiceModelKey === 'SUNTEC_SAAS_V23' \|\| seededV23Incident/);
  assert.match(requestDetail, /customerHiddenLifecycleKeys/);
});

test('home matches the UAT reference: actions at top right, search below, no duplicate lower Raise request button', () => {
  assert.match(home, /minimal-home-top-actions/);
  assert.match(home, /homeActions/);
  assert.match(home, /minimal-home-search-v231(?:4|5)/);
  assert.doesNotMatch(home, /home-primary-right/);
  assert.match(home, /minimal-home-top-actions(?:-v2315)?/);
  assert.match(css, /(?:\.minimal-home-v2314|\.home-shell-v2315)\{[\s\S]*height:100dvh/);
});

test('v23.1.4 home keeps the compact metrics and recent request list', () => {
  assert.match(home, /Needs my attention/);
  assert.match(home, /SLA at risk/);
  assert.match(home, /Your requests/);
  assert.match(css, /compact-home-metrics-v231(?:4|5)/);
  assert.match(css, /compact-request-list-v231(?:4|5)/);
});
