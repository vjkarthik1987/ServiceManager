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
const detail = read('apps/web/src/views/pages/request-detail.ejs');
const css = read('apps/web/src/public/css/app.css');

test('request detail exposes an audit-at-a-glance strip', () => {
  assert.match(detail, /issue-at-glance/);
  for (const label of ['Raised by', 'Raised', 'Support level', 'Owner', 'Last updated']) {
    assert.match(detail, new RegExp(label));
  }
  assert.match(webApp, /updatedLabel:/);
  assert.match(css, /\.issue-at-glance\{/);
});

test('non-client users can open a contextual visibility expansion control', () => {
  assert.match(detail, /canExpandVisibility = portal !== 'client'/);
  assert.match(detail, /data-open-modal="visibilityModal"/);
  assert.match(detail, /Expand who can see this request/);
  assert.match(detail, /actionBase %>\/visibility/);
});

test('visibility expansion uses existing request visibility scopes', () => {
  assert.match(apiClient, /updateRequestVisibility/);
  assert.match(apiClient, /\/v23\/visibility/);
  assert.match(requestApp, /internal_only: 0, partner_visible: 1, client_visible: 2/);
  assert.match(requestApp, /Request visibility can only be expanded after creation/);
  assert.match(requestApp, /Reason is required when expanding visibility/);
});

test('web handler audits visibility expansion and blocks client changes', () => {
  assert.match(webApp, /handleRequestVisibilityUpdate/);
  assert.match(webApp, /Client users cannot change request visibility/);
  assert.match(webApp, /eventType: 'request_visibility_changed'/);
  assert.match(webApp, /visibility expanded/);
});

test('tenant and portal request routes both support visibility expansion', () => {
  assert.match(webApp, /:portal\(admin\|client\|agent\)\/requests\/:requestId\/visibility/);
  assert.match(webApp, /:tenant\/requests\/:requestId\/visibility/);
});
