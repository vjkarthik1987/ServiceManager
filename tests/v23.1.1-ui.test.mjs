import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const issueFamilies = fs.readFileSync(path.join(root, 'apps/web/src/views/pages/issue-types.ejs'), 'utf8');
const sidebar = fs.readFileSync(path.join(root, 'apps/web/src/views/partials/sidebar.ejs'), 'utf8');
const css = fs.readFileSync(path.join(root, 'apps/web/src/public/css/app.css'), 'utf8');

test('Issue Families page removes release-version taxonomy narration', () => {
  assert.match(issueFamilies, /<h2>Issue Families<\/h2>/);
  assert.doesNotMatch(issueFamilies, /v23\.1 taxonomy/i);
  assert.doesNotMatch(issueFamilies, /Family · Issue Type · Subtype/);
});

test('Issue Families page presents three creation actions on one toolbar', () => {
  assert.match(issueFamilies, /taxonomy-head-actions/);
  assert.match(issueFamilies, /\+ Family/);
  assert.match(issueFamilies, /\+ Issue Type/);
  assert.match(issueFamilies, /\+ Subtype/);
  assert.match(css, /\.taxonomy-head-actions\{[^}]*flex-wrap:nowrap!important/s);
});

test('sidebar exposes one Issue Families navigation entry', () => {
  const matches = sidebar.match(/href="\/admin\/issue-types"/g) || [];
  assert.equal(matches.length, 1);
  assert.match(sidebar, />Issue Families<\/a>/);
  assert.doesNotMatch(sidebar, />Taxonomy 23\.1<\/a>/i);
});

test('taxonomy table uses simplified columns and actions', () => {
  assert.match(issueFamilies, /<th>Name<\/th><th>Type<\/th><th>Parent<\/th><th>Configuration<\/th><th>Status<\/th><th>Actions<\/th>/);
  assert.doesNotMatch(issueFamilies, /<th>Workflow<\/th><th>Support path<\/th><th>SLA<\/th>/);
  assert.match(issueFamilies, />Configure<\/button>/);
});
