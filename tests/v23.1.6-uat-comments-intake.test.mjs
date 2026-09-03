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
const css = read('apps/web/src/public/css/app.css');

test('client can report Incident severity at creation while support keeps post-create classification control', () => {
  assert.match(requestNew, /const showSeverity = cfg\.severity/);
  assert.match(requestNew, /Reported severity/);
  assert.match(requestNew, /Support can confirm or reclassify it during triage/);
  assert.match(webApp, /const submittedSeverityId = req\.body\.severityId/);
  assert.match(webApp, /Select a valid Severity/);
  assert.match(webApp, /if \(portal === 'client'\) \{[\s\S]*Severity is controlled by the support team/);
  assert.match(requestApp, /eventType: 'severity_changed'/);
  assert.match(requestApp, /SLA clock/);
});

test('a single enabled family is auto-selected and omitted from the visible intake journey', () => {
  assert.match(webApp, /if \(!selectedLevel1Id && activeTree\.length === 1\) selectedLevel1Id/);
  assert.match(requestNew, /familyIsAutomatic = Boolean\(selectedClient && \(activeTree \|\| \[\]\)\.length === 1\)/);
  assert.match(requestNew, /if \(!familyIsAutomatic\) steps\.push\(\{ key: 'family'/);
});

test('request intake progress stays in one horizontal row including five-step flows', () => {
  assert.match(css, /\.progressive-intake-page \.stepper\.clean-steps\.steps-5 \{[\s\S]*repeat\(5, minmax\(0, 1fr\)\)/);
  assert.match(css, /grid-auto-flow: column/);
  assert.match(css, /overflow-x: auto/);
});

test('partner composer provides a customer reply and a partner-visible internal note', () => {
  assert.match(requestDetail, /partnerView = portal === 'agent' && activeAssignment\?\.role === 'partnerUser'/);
  assert.match(requestDetail, /Reply to customer/);
  assert.match(requestDetail, /partnerView[\s\S]*value="partner_visible" \/> Internal note/);
  assert.match(webApp, /const visibility = portal === 'client' \? 'client_visible' : \(req\.body\.visibility \|\| 'client_visible'\)/);
});

test('client and partner comment lists enforce visibility boundaries', () => {
  assert.match(requestDetail, /portal === 'client' \? comment\.visibility === 'client_visible'/);
  assert.match(requestDetail, /partnerView \? \['client_visible','partner_visible'\]\.includes/);
});

test('internal and partner-only comment audit events are filtered from the client audit trail', () => {
  assert.match(requestModel, /visibility: \{ type: String, enum: \['', 'client_visible', 'partner_visible', 'internal_only'\]/);
  assert.match(requestApp, /eventType: 'comment_added'[\s\S]*visibility, actor/);
  assert.match(requestDetail, /visibleTimeline/);
  assert.match(requestDetail, /visibility !== 'internal_only' && visibility !== 'partner_visible'/);
  assert.match(requestDetail, /event\.eventType !== 'task_comment_added'/);
});

test('internal note author names remain readable regardless of generic visibility pill styling', () => {
  assert.match(css, /\.comment-item\.visibility-internal_only \.comment-meta strong,[\s\S]*color: var\(--green-dark\) !important/);
});
