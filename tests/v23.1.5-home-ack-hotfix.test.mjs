import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

const webApp = read('apps/web/src/app.js');
const home = read('apps/web/src/views/pages/simple-home.ejs');
const css = read('apps/web/src/public/css/app.css');

test('SaaS acknowledgement allows an eligible actor on an active unassigned stage', () => {
  assert.match(webApp, /function canAcknowledgeSupportStage/);
  assert.match(webApp, /if \(!stage \|\| !assignmentMatchesStage\(assignment, stage, level\)\) return false/);
  assert.match(webApp, /if \(actorMatchesStageOwner\(actor, stage\)\) return true/);
  assert.match(webApp, /const isUnassigned = !\(owner\.actorId \|\| owner\.email\)/);
  assert.match(webApp, /return Boolean\(isSaasRequest && isUnassigned\)/);
});

test('acknowledge handler infers seeded SaaS incidents and uses SaaS acknowledgement eligibility', () => {
  assert.match(webApp, /const isSaasRequest = isV23SaasRequestRecord\(request\)/);
  assert.match(webApp, /requestLooksLikeV23Incident\(request, configuredBehavior, supportPath\)/);
  assert.match(webApp, /return canAcknowledgeSupportStage\(\{/);
  assert.match(webApp, /isSaasRequest/);
});

test('Home places actions in a separate utility row above the greeting', () => {
  assert.match(home, /minimal-home-utility-row-v2315/);
  assert.match(home, /minimal-home-top-actions-v2315/);
  assert.match(home, /minimal-home-greeting-v2315/);
  assert.match(home, /minimal-home-search-v2315/);
  const utilityIndex = home.indexOf('minimal-home-utility-row-v2315');
  const greetingIndex = home.indexOf('minimal-home-greeting-v2315');
  const searchIndex = home.indexOf('minimal-home-search-v2315');
  assert.ok(utilityIndex >= 0 && utilityIndex < greetingIndex && greetingIndex < searchIndex);
});

test('Home layout cannot overlap greeting with quick actions on desktop', () => {
  assert.match(css, /\.home-shell-v2315 \.minimal-home-utility-row-v2315\{[\s\S]*grid-template-columns:1fr auto 1fr!important/);
  assert.match(css, /\.home-shell-v2315 \.minimal-home-top-actions-v2315\{[\s\S]*grid-column:3!important/);
  assert.match(css, /\.home-shell-v2315 \.minimal-home-greeting-v2315\{[\s\S]*text-align:center!important/);
  assert.doesNotMatch(home, /minimal-home-title-row/);
});

test('Home keeps a wide central search and one-screen desktop shell', () => {
  assert.match(css, /\.home-shell-v2315\{[\s\S]*height:100dvh!important/);
  assert.match(css, /\.home-shell-v2315 \.minimal-home-search-v2315\{[\s\S]*width:min\(780px,100%\)!important/);
  assert.match(css, /\.home-shell-v2315 \.compact-home-metrics-v2315,[\s\S]*width:min\(900px,100%\)!important/);
  assert.match(home, /Needs my attention/);
  assert.match(home, /Your requests/);
});
