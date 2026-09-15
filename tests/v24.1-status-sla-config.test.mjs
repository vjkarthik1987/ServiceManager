import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8');

test('v24.1 uses compact Change status control instead of Available actions', () => {
  const detail = read('apps/web/src/views/pages/request-detail.ejs');
  assert.match(detail, /inline-status-change-button/);
  assert.match(detail, />Change status<\/button>/);
  assert.doesNotMatch(detail, />Available actions<\/button>/);
  assert.doesNotMatch(detail, />Actions <span>⌄<\/span><\/button>/);
});

test('v24.1 SLA policy supports configurable clock start triggers', () => {
  const model = read('services/organization-service/src/models/SlaPolicy.js');
  for (const trigger of ['ticket_created','severity_selected','priority_selected','l2_received','l3_received','status_reached']) {
    assert.ok(model.includes(`'${trigger}'`), `${trigger} missing`);
  }
  assert.match(model, /clockStartStatusId/);
  const web = read('apps/web/src/app.js');
  assert.match(web, /clockStartStatusId: String\(policy\.clockStartStatusId/);
});

test('v24.1 SLA runtime waits for configured L2 L3 or status trigger', () => {
  const request = read('services/request-service/src/app.js');
  assert.match(request, /function slaClockTriggerResult/);
  assert.match(request, /trigger === 'l2_received'/);
  assert.match(request, /trigger === 'l3_received'/);
  assert.match(request, /trigger === 'status_reached'/);
  assert.match(request, /const startedAt = requestItem\.sla\?\.startedAt \|\| trigger\.startedAt \|\| now;/);
});

test('v24.1 customer-backed Incident default documents clock start at issue creation', () => {
  const config = JSON.parse(read('config/v24-saas/service-model.json'));
  assert.ok(['24.1.0','24.2.0','24.2.1','24.2.2','24.2.3','24.2.4','25.0.0'].includes(config.version));
  assert.match(config.sla.incident.startRule, /default ON_ISSUE_CREATED/);
});
