#!/usr/bin/env node
/**
 * Verifies the v23 hard boundary: normal Incident Management must not be
 * classified as the SunTec SaaS v23 model without the exact marker/binding.
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import {
  V23_SAAS_SERVICE_MODEL_KEY,
  V23_MARKER_FIELD_KEY,
  isV23SaasRequest,
  isV23SaasIncident,
  assertNormalIncidentUntouched,
  ensureMarkerCustomField
} from '../lib/v23-saas-core.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = process.cwd();
const errors = [];

function check(condition, message) {
  if (!condition) errors.push(message);
}

const normalIncident = {
  level1Type: { code: 'INCIDENT', name: 'Incident' },
  level2Type: { code: 'APPLICATION_INCIDENT', name: 'Application Incident' },
  currentSupportLevel: 'L1',
  currentStatus: { localId: 'new', name: 'New', statusType: 'start' },
  activeStages: [{ localId: 'L1', currentStatus: { localId: 'new', name: 'New', statusType: 'start' } }],
  tasks: [{ taskId: 'normal-1', status: 'open' }],
  severity: { code: 'S3' },
  priority: { code: 'P3' },
  sla: { state: 'running', startedAt: '2026-09-01T00:00:00.000Z' }
};
const cloned = JSON.parse(JSON.stringify(normalIncident));
check(isV23SaasRequest(normalIncident) === false, 'A normal Incident was classified as v23 SaaS without a marker.');
check(isV23SaasIncident(normalIncident) === false, 'A normal Incident activated v23 SaaS Incident rules.');
try { assertNormalIncidentUntouched(normalIncident, cloned); } catch (error) { errors.push(error.message); }

const saasIncident = {
  ...JSON.parse(JSON.stringify(normalIncident)),
  customFields: ensureMarkerCustomField([])
};
check(isV23SaasRequest(saasIncident) === true, 'A marked SaaS request did not activate v23.');
check(isV23SaasIncident(saasIncident) === true, 'A marked SaaS Incident did not activate v23 Incident rules.');

const requestServicePath = path.join(projectRoot, 'services/request-service/src/app.js');
if (fs.existsSync(requestServicePath)) {
  const source = fs.readFileSync(requestServicePath, 'utf8');
  check(source.includes(V23_SAAS_SERVICE_MODEL_KEY), 'request-service does not contain the v23 exact service-model marker.');
  check(!/function\s+isSaasIncidentRequest[\s\S]{0,250}?return\s+\/\\bincident\\b\/i\.test\(requestFamilyText\(value\)\);/.test(source),
    'request-service still has the v22 broad Incident-name classifier.');
}

const detailPath = path.join(projectRoot, 'apps/web/src/views/pages/request-detail.ejs');
if (fs.existsSync(detailPath)) {
  const source = fs.readFileSync(detailPath, 'utf8');
  check(source.includes(V23_SAAS_SERVICE_MODEL_KEY), 'request-detail.ejs is missing the v23 marker guard.');
  check(!/const\s+isSaasIncident\s*=\s*\/\\bincident\\b\/i\.test\(requestFamilyText\)/.test(source),
    'request-detail.ejs still infers SaaS Incident from the word Incident alone.');
}


const formPartialCandidates = [
  path.join(projectRoot, 'apps/web/src/views/partials/v23-saas-form-engine.ejs'),
  path.join(projectRoot, 'templates/v23-saas-form-engine.ejs')
];
const formPartialPath = formPartialCandidates.find((candidate) => fs.existsSync(candidate));
if (formPartialPath) {
  const source = fs.readFileSync(formPartialPath, 'utf8');
  check(source.includes('fetchExactBinding'), 'v23 form engine is not using exact server-side type-binding lookup.');
  check(source.includes('Failure never falls back to label matching.'), 'v23 form engine is missing the no-label-fallback guard.');
  check(!source.includes('candidates.includes(name)'), 'v23 form engine still activates from subtype display names.');
  check(!source.includes('formNames(form)'), 'v23 form engine still contains local subtype-name matching.');
}

const provisionerPath = path.join(projectRoot, 'scripts/provision-v23-saas-service-model.mjs');
if (fs.existsSync(provisionerPath)) {
  const source = fs.readFileSync(provisionerPath, 'utf8');
  check(source.includes('--approve-bindings'), 'v23 provisioner is missing explicit collection:id approval for ambiguous subtype rows.');
  check(!source.includes('hasSaasEvidence(doc) || CONFIRM_CATALOGUE'), 'v23 provisioner still permits blanket exact-name catalogue confirmation.');
}

const configPath = path.join(projectRoot, 'config/v23-saas/service-model.json');
if (fs.existsSync(configPath)) {
  const manifest = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  check(manifest.key === V23_SAAS_SERVICE_MODEL_KEY, 'v23 service-model manifest key is incorrect.');
  check(manifest.guard?.normalIncidentUntouched === true, 'normalIncidentUntouched guard is not enabled in the manifest.');
  check(manifest.guard?.markerFieldKey === V23_MARKER_FIELD_KEY, 'marker field key differs from runtime guard.');
}

if (errors.length) {
  console.error('v23 NORMAL INCIDENT GUARD: FAILED');
  for (const error of errors) console.error(`  ✗ ${error}`);
  process.exitCode = 1;
} else {
  console.log('v23 NORMAL INCIDENT GUARD: PASSED');
  console.log(`  ✓ Normal Incident does not match ${V23_SAAS_SERVICE_MODEL_KEY} by name.`);
  console.log('  ✓ Only exact v23 marker/type binding activates SaaS runtime behavior.');
  console.log('  ✓ Normal Incident state is unchanged by v23 core helpers.');
}
