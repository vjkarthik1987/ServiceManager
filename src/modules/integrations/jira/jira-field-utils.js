const SYSTEM_FIELDS = new Set(['summary', 'description', 'priority', 'labels', 'project', 'issuetype', 'assignee', 'reporter', 'components', 'versions', 'fixVersions', 'environment', 'duedate', 'parent']);

function isValidJiraFieldKey(fieldId = '') {
  const key = String(fieldId || '').trim();
  if (!key) return false;
  if (SYSTEM_FIELDS.has(key)) return true;
  return /^customfield_\d+$/i.test(key);
}

function sanitizeMetadataFields(fields = []) {
  return (fields || []).filter((field) => isValidJiraFieldKey(field?.fieldId || field?.key || ''));
}

function sanitizeJiraFieldValues(values = {}, metadataFields = []) {
  const allowed = new Set(sanitizeMetadataFields(metadataFields).map((field) => String(field.fieldId || field.key || '')));
  const sanitized = {};
  for (const [key, value] of Object.entries(values || {})) {
    const trimmedKey = String(key || '').trim();
    if (!isValidJiraFieldKey(trimmedKey)) continue;
    if (allowed.size && !allowed.has(trimmedKey)) continue;
    sanitized[trimmedKey] = value;
  }
  return sanitized;
}

module.exports = {
  SYSTEM_FIELDS,
  isValidJiraFieldKey,
  sanitizeMetadataFields,
  sanitizeJiraFieldValues
};
