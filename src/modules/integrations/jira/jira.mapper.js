const { isValidJiraFieldKey, sanitizeMetadataFields } = require('./jira-field-utils');
function textNode(text) {
  return { type: 'text', text: String(text || '') };
}

function paragraph(text) {
  return { type: 'paragraph', content: [textNode(text)] };
}

function heading(text, level = 3) {
  return { type: 'heading', attrs: { level }, content: [textNode(text)] };
}

function bulletList(items = []) {
  const filtered = items.filter((item) => String(item || '').trim());
  if (!filtered.length) return null;
  return {
    type: 'bulletList',
    content: filtered.map((item) => ({ type: 'listItem', content: [paragraph(item)] }))
  };
}

function buildJiraDescriptionAdf(issue, tenantName, entityName) {
  const content = [
    heading('ESOP Issue Context', 3),
    bulletList([
      `ESOP Issue Key: ${issue.issueNumber || issue._id || ''}`,
      `Tenant: ${tenantName || ''}`,
      `Entity: ${entityName || ''}`,
      `Category: ${issue.category || ''}`,
      `Priority: ${issue.priority || ''}`
    ]),
    heading('Description', 3),
    paragraph(issue.description || 'No description provided.')
  ].filter(Boolean);

  return { type: 'doc', version: 1, content };
}

function toAdfDocument(text) {
  return { type: 'doc', version: 1, content: [paragraph(text || '')] };
}

function normalizeArrayValue(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    return value.split(',').map((item) => item.trim()).filter(Boolean);
  }
  return [];
}

function mapDynamicJiraFields(fields = {}, metadataFields = []) {
  const metadataById = new Map(sanitizeMetadataFields(metadataFields).map((item) => [item.fieldId, item]));
  const mapped = {};
  for (const [fieldId, rawValue] of Object.entries(fields || {})) {
    if (rawValue === null || typeof rawValue === 'undefined' || rawValue === '') continue;
    if (!isValidJiraFieldKey(fieldId)) continue;
    if (fieldId === 'summary' || fieldId === 'description' || fieldId === 'project' || fieldId === 'issuetype') continue;
    const metadata = metadataById.get(fieldId) || {};
    const uiType = metadata.uiType || 'text';
    const schemaType = metadata.schemaType || '';
    if (uiType === 'textarea') {
      mapped[fieldId] = toAdfDocument(rawValue);
      continue;
    }
    if (uiType === 'labels') {
      mapped[fieldId] = normalizeArrayValue(rawValue);
      continue;
    }
    if (uiType === 'multiselect') {
      mapped[fieldId] = normalizeArrayValue(rawValue).map((value) => ({ id: value }));
      continue;
    }
    if (uiType === 'select') {
      mapped[fieldId] = { id: String(rawValue) };
      continue;
    }
    if (fieldId === 'versions') {
      mapped[fieldId] = normalizeArrayValue(rawValue).map((value) => ({ id: value }));
      continue;
    }
    if (schemaType === 'number') {
      mapped[fieldId] = Number(rawValue);
      continue;
    }
    mapped[fieldId] = rawValue;
  }
  return mapped;
}

function mapIssueToJiraPayload({ issue, projectKey, tenantName, entityName, issueTypeId, issueTypeName, jiraFields = {}, metadataFields = [] }) {
  const minimalMode = String(process.env.JIRA_INTAKE_MINIMAL_MODE || 'true').toLowerCase() !== 'false';
  return {
    fields: {
      project: { key: projectKey },
      summary: issue.title,
      issuetype: issueTypeId ? { id: String(issueTypeId) } : { name: issueTypeName || 'Bug' },
      description: buildJiraDescriptionAdf(issue, tenantName, entityName),
      ...(minimalMode ? {} : mapDynamicJiraFields(jiraFields, metadataFields))
    }
  };
}

module.exports = {
  mapIssueToJiraPayload,
  buildJiraDescriptionAdf,
  mapDynamicJiraFields,
  toAdfDocument
};
