const { jiraRequest, isMockMode } = require('./jira.service');

function normalizeAllowedValue(value) {
  if (!value || typeof value !== 'object') return value;
  return {
    id: value.id || '',
    value: value.value || value.name || value.key || value.accountId || String(value.id || ''),
    name: value.name || value.value || value.key || '',
    key: value.key || '',
    raw: value
  };
}

function inferUiType(field = {}) {
  const schemaType = field.schema?.type || '';
  const custom = field.schema?.custom || '';
  if (field.allowedValues?.length) {
    if (schemaType === 'array') return 'multiselect';
    return 'select';
  }
  if (schemaType === 'array' && custom.includes('labels')) return 'labels';
  if (schemaType === 'array') return 'multivalue';
  if (schemaType === 'string' && custom.includes('textarea')) return 'textarea';
  if (schemaType === 'string' && /description|details|outcome/i.test(field.name || '')) return 'textarea';
  if (schemaType === 'string') return 'text';
  if (schemaType === 'number') return 'number';
  if (schemaType === 'date' || schemaType === 'datetime') return 'date';
  return 'text';
}

function normalizeCreateFields(fields = {}) {
  return Object.entries(fields).map(([fieldId, field]) => ({
    fieldId,
    key: field.key || fieldId,
    name: field.name || fieldId,
    required: !!field.required,
    schemaType: field.schema?.type || '',
    uiType: inferUiType(field),
    allowedValues: Array.isArray(field.allowedValues) ? field.allowedValues.map(normalizeAllowedValue) : []
  }));
}

function getMockProjects() {
  return [
    { id: '10000', key: 'STP', name: 'Solution Test Project' },
    { id: '10001', key: 'INT', name: 'Integration Project' }
  ];
}

function getMockIssueTypes(projectKey) {
  const upper = String(projectKey || '').toUpperCase();
  if (upper === 'STP') {
    return [
      { id: '20000', name: 'Bug', description: 'STP defect' },
      { id: '20001', name: 'Task', description: 'STP task' }
    ];
  }
  return [
    { id: '20010', name: 'Task', description: 'Generic task' },
    { id: '20011', name: 'Story', description: 'Generic story' }
  ];
}

function getMockFieldMetadata(projectKey, issueTypeId, issueTypeName) {
  const issueType = String(issueTypeName || '').toLowerCase();
  if (String(projectKey || '').toUpperCase() === 'STP' && issueType === 'bug') {
    return {
      source: 'MOCK',
      projectKey: 'STP',
      issueTypeId: issueTypeId || '20000',
      issueTypeName: 'Bug',
      fields: [
        { fieldId: 'summary', key: 'summary', name: 'Summary', required: true, schemaType: 'string', uiType: 'text', allowedValues: [] },
        { fieldId: 'description', key: 'description', name: 'Description', required: true, schemaType: 'string', uiType: 'textarea', allowedValues: [] },
        { fieldId: 'customfield_functionalarea', key: 'customfield_functionalarea', name: 'Functional Area', required: true, schemaType: 'option', uiType: 'select', allowedValues: [{ id: 'fa-1', value: 'Payments' }, { id: 'fa-2', value: 'Pricing' }, { id: 'fa-3', value: 'Billing' }] },
        { fieldId: 'customfield_environment', key: 'customfield_environment', name: 'Environment Details', required: true, schemaType: 'string', uiType: 'textarea', allowedValues: [] },
        { fieldId: 'customfield_expected', key: 'customfield_expected', name: 'Expected Outcome', required: true, schemaType: 'string', uiType: 'textarea', allowedValues: [] },
        { fieldId: 'customfield_actual', key: 'customfield_actual', name: 'Actual Outcome', required: true, schemaType: 'string', uiType: 'textarea', allowedValues: [] },
        { fieldId: 'versions', key: 'versions', name: 'Affects versions', required: true, schemaType: 'array', uiType: 'select', allowedValues: [{ id: 'ver-1', value: '1.0.0' }, { id: 'ver-2', value: '1.1.0' }] }
      ]
    };
  }
  return {
    source: 'MOCK',
    projectKey: String(projectKey || '').toUpperCase(),
    issueTypeId: issueTypeId || '20010',
    issueTypeName: issueTypeName || 'Task',
    fields: [
      { fieldId: 'summary', key: 'summary', name: 'Summary', required: true, schemaType: 'string', uiType: 'text', allowedValues: [] },
      { fieldId: 'description', key: 'description', name: 'Description', required: true, schemaType: 'string', uiType: 'textarea', allowedValues: [] }
    ]
  };
}

async function listJiraProjects(connection) {
  if (isMockMode()) return getMockProjects();
  const response = await jiraRequest({
    baseUrl: connection.baseUrl,
    method: 'GET',
    path: '/rest/api/3/project/search?maxResults=100',
    email: connection.email,
    apiToken: connection.apiToken
  });
  return (response.data?.values || []).map((project) => ({ id: String(project.id || ''), key: project.key, name: project.name }));
}

async function listJiraIssueTypesForProject(connection, projectKey) {
  if (isMockMode()) return getMockIssueTypes(projectKey);
  const response = await jiraRequest({
    baseUrl: connection.baseUrl,
    method: 'GET',
    path: `/rest/api/3/issue/createmeta/${encodeURIComponent(projectKey)}/issuetypes`,
    email: connection.email,
    apiToken: connection.apiToken
  });
  const values = response.data?.issueTypes || response.data?.values || [];
  return values.map((item) => ({ id: String(item.id || ''), name: item.name, description: item.description || '' }));
}

async function getCreateFieldMetadata(connection, projectKey, issueTypeId, issueTypeName = '') {
  if (isMockMode()) return getMockFieldMetadata(projectKey, issueTypeId, issueTypeName);
  const response = await jiraRequest({
    baseUrl: connection.baseUrl,
    method: 'GET',
    path: `/rest/api/3/issue/createmeta/${encodeURIComponent(projectKey)}/issuetypes/${encodeURIComponent(issueTypeId)}`,
    email: connection.email,
    apiToken: connection.apiToken
  });
  return {
    source: 'LIVE',
    projectKey: String(projectKey || '').toUpperCase(),
    issueTypeId: String(issueTypeId || ''),
    issueTypeName: issueTypeName || response.data?.name || '',
    fields: normalizeCreateFields(response.data?.fields || {})
  };
}



async function resolveIssueTypeForProject(connection, projectKey, issueTypeId = '', issueTypeName = '') {
  const trimmedId = String(issueTypeId || '').trim();
  const trimmedName = String(issueTypeName || '').trim();
  if (trimmedId && trimmedName) return { issueTypeId: trimmedId, issueTypeName: trimmedName };
  const issueTypes = await listJiraIssueTypesForProject(connection, projectKey);
  if (trimmedId) {
    const foundById = issueTypes.find((item) => String(item.id) === trimmedId);
    return { issueTypeId: trimmedId, issueTypeName: foundById?.name || trimmedName };
  }
  if (trimmedName) {
    const foundByName = issueTypes.find((item) => String(item.name || '').toLowerCase() == trimmedName.toLowerCase());
    if (foundByName) return { issueTypeId: String(foundByName.id || ''), issueTypeName: foundByName.name || trimmedName };
  }
  const task = issueTypes.find((item) => String(item.name || '').toLowerCase() === 'task');
  if (task) return { issueTypeId: String(task.id || ''), issueTypeName: task.name || 'Task' };
  const first = issueTypes[0];
  if (first) return { issueTypeId: String(first.id || ''), issueTypeName: first.name || '' };
  return { issueTypeId: trimmedId, issueTypeName: trimmedName };
}

module.exports = {
  listJiraProjects,
  listJiraIssueTypesForProject,
  resolveIssueTypeForProject,
  getCreateFieldMetadata,
  normalizeCreateFields,
  getMockFieldMetadata
};
