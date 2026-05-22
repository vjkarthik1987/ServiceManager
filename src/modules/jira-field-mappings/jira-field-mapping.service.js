const { JiraFieldMapping } = require('./jira-field-mapping.model');

function normalizeUpper(value) {
  return String(value || '').trim().toUpperCase();
}

function readNested(source, path) {
  if (!source || !path) return undefined;
  return String(path)
    .split('.')
    .filter(Boolean)
    .reduce((acc, key) => (acc && typeof acc === 'object' ? acc[key] : undefined), source);
}

function applyTransform(transform, value) {
  if (value === null || typeof value === 'undefined') return value;
  const text = Array.isArray(value) ? value.join(', ') : String(value);
  switch (String(transform || 'NONE').toUpperCase()) {
    case 'UPPERCASE': return text.toUpperCase();
    case 'LOWERCASE': return text.toLowerCase();
    case 'CSV':
      return Array.isArray(value) ? value : text.split(',').map((item) => item.trim()).filter(Boolean);
    case 'PRIORITY_TO_SEVERITY': {
      const normalized = text.trim().toUpperCase();
      const map = { LOW: 'Minor', MEDIUM: 'Major', HIGH: 'Critical', CRITICAL: 'Blocker', BLOCKER: 'Blocker' };
      return map[normalized] || text;
    }
    default:
      return value;
  }
}

function resolveRawValue(mapping, context) {
  const sourceType = String(mapping.sourceType || 'STATIC').toUpperCase();
  if (sourceType === 'STATIC') return mapping.staticValue;
  if (sourceType === 'ISSUE_FIELD') return readNested(context.issue, mapping.sourcePath);
  if (sourceType === 'ENTITY_METADATA') return readNested(context.entity, `metadata.${mapping.sourcePath}`) ?? readNested(context.entity, mapping.sourcePath);
  if (sourceType === 'REPORTER') return readNested(context.reporter, mapping.sourcePath);
  if (sourceType === 'CONTEXT') return readNested(context, mapping.sourcePath);
  return mapping.staticValue;
}

function serializeMapping(mapping) {
  return {
    id: String(mapping._id),
    tenantId: String(mapping.tenantId),
    entityId: mapping.entityId ? String(mapping.entityId) : null,
    projectKey: mapping.projectKey,
    issueTypeId: mapping.issueTypeId,
    issueTypeName: mapping.issueTypeName || '',
    fieldId: mapping.fieldId,
    fieldName: mapping.fieldName || '',
    sourceType: mapping.sourceType,
    sourcePath: mapping.sourcePath || '',
    staticValue: mapping.staticValue || '',
    transform: mapping.transform || 'NONE',
    applyMode: mapping.applyMode || 'DEFAULT_ONLY',
    helpText: mapping.helpText || '',
    isActive: !!mapping.isActive,
    sortOrder: Number(mapping.sortOrder || 100),
    createdAt: mapping.createdAt,
    updatedAt: mapping.updatedAt
  };
}

async function listMappingsForContext({ tenantId, entityId = null, projectKey, issueTypeId }) {
  const normalizedProjectKey = normalizeUpper(projectKey);
  const mappings = await JiraFieldMapping.find({
    tenantId,
    projectKey: normalizedProjectKey,
    issueTypeId: String(issueTypeId || '').trim(),
    isActive: true,
    $or: [{ entityId: null }, ...(entityId ? [{ entityId }] : [])]
  }).sort({ entityId: -1, sortOrder: 1, fieldName: 1, fieldId: 1 });

  const deduped = new Map();
  for (const mapping of mappings) {
    const key = String(mapping.fieldId || '');
    if (!key || deduped.has(key)) continue;
    deduped.set(key, mapping);
  }
  return Array.from(deduped.values());
}

async function resolveMappedFields({ tenantId, entityId = null, projectKey, issueTypeId, existingFields = {}, context = {} }) {
  const mappings = await listMappingsForContext({ tenantId, entityId, projectKey, issueTypeId });
  const merged = { ...(existingFields || {}) };
  const applied = [];

  for (const mapping of mappings) {
    const currentValue = merged[mapping.fieldId];
    const hasCurrentValue = Array.isArray(currentValue) ? currentValue.length > 0 : !(currentValue === '' || currentValue === null || typeof currentValue === 'undefined');
    if (mapping.applyMode === 'DEFAULT_ONLY' && hasCurrentValue) continue;
    const rawValue = resolveRawValue(mapping, context);
    const finalValue = applyTransform(mapping.transform, rawValue);
    const hasResolvedValue = Array.isArray(finalValue) ? finalValue.length > 0 : !(finalValue === '' || finalValue === null || typeof finalValue === 'undefined');
    if (!hasResolvedValue) continue;
    merged[mapping.fieldId] = finalValue;
    applied.push({
      fieldId: mapping.fieldId,
      fieldName: mapping.fieldName || mapping.fieldId,
      sourceType: mapping.sourceType,
      sourcePath: mapping.sourcePath || '',
      applyMode: mapping.applyMode,
      transform: mapping.transform,
      value: finalValue
    });
  }

  return { fields: merged, mappings, applied };
}

async function upsertFieldMapping({ tenantId, entityId = null, payload, actorUserId = null }) {
  const query = {
    tenantId,
    entityId: entityId || null,
    projectKey: normalizeUpper(payload.projectKey),
    issueTypeId: String(payload.issueTypeId || '').trim(),
    fieldId: String(payload.fieldId || '').trim(),
    isActive: true
  };
  const update = {
    tenantId,
    entityId: entityId || null,
    projectKey: normalizeUpper(payload.projectKey),
    issueTypeId: String(payload.issueTypeId || '').trim(),
    issueTypeName: String(payload.issueTypeName || '').trim(),
    fieldId: String(payload.fieldId || '').trim(),
    fieldName: String(payload.fieldName || '').trim(),
    sourceType: String(payload.sourceType || 'STATIC').trim().toUpperCase(),
    sourcePath: String(payload.sourcePath || '').trim(),
    staticValue: typeof payload.staticValue === 'undefined' ? '' : String(payload.staticValue),
    transform: String(payload.transform || 'NONE').trim().toUpperCase(),
    applyMode: String(payload.applyMode || 'DEFAULT_ONLY').trim().toUpperCase(),
    helpText: String(payload.helpText || '').trim(),
    isActive: payload.isActive !== false,
    sortOrder: Number(payload.sortOrder || 100),
    updatedByUserId: actorUserId
  };

  const existing = await JiraFieldMapping.findOne(query);
  if (existing) {
    Object.assign(existing, update);
    await existing.save();
    return existing;
  }
  return JiraFieldMapping.create({ ...update, createdByUserId: actorUserId });
}

module.exports = {
  serializeMapping,
  listMappingsForContext,
  resolveMappedFields,
  upsertFieldMapping,
  applyTransform
};
