import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8');

test('v24.1 renders service_context dynamic fields including Components', () => {
  const engine = read('apps/web/src/views/partials/v23-saas-form-engine.ejs');
  assert.match(engine, /const preferredOrder = \['what_happened','service_context','security_context','evidence','additional'\];/);

  const forms = JSON.parse(read('config/v24-saas/form-definitions.json'));
  const incidentForms = (forms.forms || []).filter((form) => form.family === 'INCIDENT');
  assert.equal(incidentForms.length, 4);
  for (const form of incidentForms) {
    const component = (form.fields || []).find((field) => field.key === 'COMPONENTS');
    assert.ok(component, `${form.key} must include COMPONENTS`);
    assert.equal(component.section, 'service_context');
  }
});

test('v24.1 removes lifecycle/RCA fields from Incident creation for every creator portal', () => {
  const app = read('apps/web/src/app.js');
  assert.match(app, /function filterIncidentCreationLifecycleFields/);
  assert.doesNotMatch(app, /portal !== 'client' \|\| !\(incident \|\| isV23SaasIncidentBehaviorNode/);
  assert.match(app, /!V23_INCIDENT_LIFECYCLE_FIELD_KEYS\.has/);
  assert.match(app, /filterIncidentCreationLifecycleFields\(activeCustomFields\(behaviorNode \|\| \{\}\)/);
  assert.match(app, /filterIncidentCreationLifecycleFields\(activeCustomFields\(behaviorNode\)/);
});

test('v24.1 lifecycle field set contains the RCA fields reported in UAT', () => {
  const app = read('apps/web/src/app.js');
  for (const key of ['RCA_CATEGORY','ROOT_CAUSE','CORRECTIVE_ACTION','PREVENTIVE_ACTION','RCA_STATUS']) {
    assert.ok(app.includes(`'${key}'`), `${key} missing from lifecycle exclusion set`);
  }
});
