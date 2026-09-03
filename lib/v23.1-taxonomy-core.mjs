export const V23_1_TAXONOMY_VERSION = '23.1';

export const TAXONOMY_LEVELS = Object.freeze({
  FAMILY: 1,
  ISSUE_TYPE: 2,
  SUBTYPE: 3
});

export function taxonomyKind(level) {
  if (Number(level) === TAXONOMY_LEVELS.FAMILY) return 'family';
  if (Number(level) === TAXONOMY_LEVELS.ISSUE_TYPE) return 'issueType';
  if (Number(level) === TAXONOMY_LEVELS.SUBTYPE) return 'subtype';
  return 'unknown';
}

export function expectedParentLevel(level) {
  const n = Number(level);
  if (n === TAXONOMY_LEVELS.FAMILY) return null;
  if (n === TAXONOMY_LEVELS.ISSUE_TYPE) return TAXONOMY_LEVELS.FAMILY;
  if (n === TAXONOMY_LEVELS.SUBTYPE) return TAXONOMY_LEVELS.ISSUE_TYPE;
  return undefined;
}

export function validateTaxonomyParent(level, parent = null) {
  const expected = expectedParentLevel(level);
  if (expected === undefined) return { ok: false, message: 'Taxonomy level must be 1, 2 or 3.' };
  if (expected === null) {
    if (parent) return { ok: false, message: 'A Family cannot have a parent.' };
    return { ok: true };
  }
  if (!parent) return { ok: false, message: `${taxonomyKind(level)} requires a parent.` };
  if (Number(parent.level) !== expected) {
    return { ok: false, message: `${taxonomyKind(level)} must be placed below ${taxonomyKind(expected)}.` };
  }
  return { ok: true };
}

export function normalizeBehavior(node = {}) {
  return {
    workflowId: node.workflowId || null,
    supportPathId: node.supportPathId || null,
    slaApplicable: node.slaApplicable !== false,
    slaPolicyId: node.slaPolicyId || null,
    formDefinitionKey: String(node.formDefinitionKey || '').trim().toUpperCase(),
    approvalPolicyKey: String(node.approvalPolicyKey || '').trim().toUpperCase(),
    notificationPolicyKey: String(node.notificationPolicyKey || '').trim().toUpperCase(),
    fieldsConfig: node.fieldsConfig || {},
    customFields: Array.isArray(node.customFields) ? node.customFields : []
  };
}

export function effectiveBehavior(issueType = {}, subtype = null) {
  const parent = normalizeBehavior(issueType);
  if (!subtype) return parent;
  const child = normalizeBehavior(subtype);
  return {
    workflowId: child.workflowId || parent.workflowId || null,
    supportPathId: child.supportPathId || parent.supportPathId || null,
    slaApplicable: subtype.slaApplicable === undefined ? parent.slaApplicable : child.slaApplicable,
    slaPolicyId: child.slaPolicyId || parent.slaPolicyId || null,
    formDefinitionKey: child.formDefinitionKey || parent.formDefinitionKey || '',
    approvalPolicyKey: child.approvalPolicyKey || parent.approvalPolicyKey || '',
    notificationPolicyKey: child.notificationPolicyKey || parent.notificationPolicyKey || '',
    fieldsConfig: Object.keys(child.fieldsConfig || {}).length ? child.fieldsConfig : parent.fieldsConfig,
    customFields: child.customFields.length ? child.customFields : parent.customFields
  };
}

function plain(item) {
  return typeof item?.toObject === 'function' ? item.toObject() : { ...(item || {}) };
}

export function buildThreeLevelTaxonomy(items = [], decorators = {}) {
  const nodes = items.map(plain);
  const level1 = nodes.filter((item) => Number(item.level) === 1);
  const level2 = nodes.filter((item) => Number(item.level) === 2);
  const level3 = nodes.filter((item) => Number(item.level) === 3);
  const decorate = typeof decorators.decorate === 'function' ? decorators.decorate : (item) => item;

  return level1.map((family) => ({
    ...family,
    kind: 'family',
    children: level2
      .filter((issueType) => String(issueType.parentTypeId || '') === String(family._id || family.id || ''))
      .map((issueType) => ({
        ...decorate(issueType),
        kind: 'issueType',
        children: level3
          .filter((subtype) => String(subtype.parentTypeId || '') === String(issueType._id || issueType.id || ''))
          .map((subtype) => ({ ...decorate(subtype), kind: 'subtype' }))
      }))
  }));
}

export function enabledFamilyIds(client = {}) {
  return (client.enabledFamilyIds || []).map(String).filter(Boolean);
}
