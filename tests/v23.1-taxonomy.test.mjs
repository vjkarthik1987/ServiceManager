import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TAXONOMY_LEVELS,
  taxonomyKind,
  validateTaxonomyParent,
  effectiveBehavior,
  buildThreeLevelTaxonomy,
  enabledFamilyIds
} from '../lib/v23.1-taxonomy-core.mjs';

test('v23.1 exposes Family → Issue Type → Subtype levels', () => {
  assert.equal(taxonomyKind(TAXONOMY_LEVELS.FAMILY), 'family');
  assert.equal(taxonomyKind(TAXONOMY_LEVELS.ISSUE_TYPE), 'issueType');
  assert.equal(taxonomyKind(TAXONOMY_LEVELS.SUBTYPE), 'subtype');
});

test('Issue Type must be below Family and Subtype below Issue Type', () => {
  assert.equal(validateTaxonomyParent(2, { level: 1 }).ok, true);
  assert.equal(validateTaxonomyParent(3, { level: 2 }).ok, true);
  assert.equal(validateTaxonomyParent(3, { level: 1 }).ok, false);
  assert.equal(validateTaxonomyParent(1, { level: 1 }).ok, false);
});

test('Subtype behavior overrides Issue Type behavior while inheriting blank references', () => {
  const result = effectiveBehavior(
    { workflowId: 'wf-parent', supportPathId: 'sp-parent', slaApplicable: true, formDefinitionKey: 'FORM_PARENT', approvalPolicyKey: 'AP_PARENT' },
    { workflowId: 'wf-child', supportPathId: null, slaApplicable: false, formDefinitionKey: '', notificationPolicyKey: 'NT_CHILD' }
  );
  assert.equal(result.workflowId, 'wf-child');
  assert.equal(result.supportPathId, 'sp-parent');
  assert.equal(result.slaApplicable, false);
  assert.equal(result.formDefinitionKey, 'FORM_PARENT');
  assert.equal(result.approvalPolicyKey, 'AP_PARENT');
  assert.equal(result.notificationPolicyKey, 'NT_CHILD');
});

test('three-level tree nests issue types and subtypes under the right family', () => {
  const tree = buildThreeLevelTaxonomy([
    { _id: 'f1', level: 1, name: 'Request' },
    { _id: 't1', level: 2, parentTypeId: 'f1', name: 'Incident' },
    { _id: 's1', level: 3, parentTypeId: 't1', name: 'Application' },
    { _id: 's2', level: 3, parentTypeId: 't1', name: 'Security' }
  ]);
  assert.equal(tree.length, 1);
  assert.equal(tree[0].children.length, 1);
  assert.equal(tree[0].children[0].children.length, 2);
  assert.equal(tree[0].children[0].children[0].name, 'Application');
});

test('client family enablement uses enabledFamilyIds', () => {
  assert.deepEqual(enabledFamilyIds({ enabledFamilyIds: ['a', 'b'] }), ['a', 'b']);
  assert.deepEqual(enabledFamilyIds({ enabledLevel1IssueTypeIds: ['legacy'] }), []);
});
