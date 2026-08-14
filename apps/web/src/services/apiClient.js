import { config } from '../config.js';

async function request(url, options = {}) {
  const response = await fetch(url, {
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {})
    },
    ...options
  });

  const text = await response.text();
  let payload = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = { message: text };
    }
  }

  if (!response.ok) {
    const message = payload?.message || `Request failed with status ${response.status}`;
    const error = new Error(message);
    error.status = response.status;
    error.payload = payload;
    throw error;
  }

  return payload;
}

const orgUrl = (path) => `${config.organizationServiceUrl}${path}`;

export async function getLatestOrganization() {
  try {
    return await request(orgUrl('/api/organizations/latest'));
  } catch (error) {
    if (error.status === 404) return null;
    throw error;
  }
}

export async function getOrganization(organizationId) {
  return request(orgUrl(`/api/organizations/${organizationId}`));
}

export async function getOrganizationSummary(organizationId) {
  return request(orgUrl(`/api/organizations/${organizationId}/summary`));
}

export async function createOrganization(data) {
  return request(orgUrl('/api/organizations'), {
    method: 'POST',
    body: JSON.stringify(data)
  });
}

export async function deletePendingOrganization(organizationId) {
  return request(orgUrl(`/api/organizations/${organizationId}/pending`), { method: 'DELETE' });
}

export async function activateOrganization(organizationId) {
  return request(orgUrl(`/api/organizations/${organizationId}/activate`), { method: 'POST', body: JSON.stringify({}) });
}

export async function listIssueTypes(organizationId) {
  return request(orgUrl(`/api/organizations/${organizationId}/issue-types`));
}

export async function createLevel1IssueType(organizationId, data) {
  return request(orgUrl(`/api/organizations/${organizationId}/issue-types/level1`), {
    method: 'POST',
    body: JSON.stringify(data)
  });
}

export async function createLevel2IssueType(organizationId, data) {
  return request(orgUrl(`/api/organizations/${organizationId}/issue-types/level2`), {
    method: 'POST',
    body: JSON.stringify(data)
  });
}


export async function updateIssueType(organizationId, issueTypeId, data) {
  return request(orgUrl(`/api/organizations/${organizationId}/issue-types/${issueTypeId}`), {
    method: 'POST',
    body: JSON.stringify(data)
  });
}

export async function updateWorkflow(organizationId, workflowId, data) {
  return request(orgUrl(`/api/organizations/${organizationId}/workflows/${workflowId}`), {
    method: 'POST',
    body: JSON.stringify(data)
  });
}

export async function updateSupportPath(organizationId, supportPathId, data) {
  return request(orgUrl(`/api/organizations/${organizationId}/support-paths/${supportPathId}`), {
    method: 'POST',
    body: JSON.stringify(data)
  });
}

export async function updateSlaPolicy(organizationId, slaPolicyId, data) {
  return request(orgUrl(`/api/organizations/${organizationId}/slas/${slaPolicyId}`), {
    method: 'POST',
    body: JSON.stringify(data)
  });
}

export async function updateSeverity(organizationId, severityId, data) {
  return request(orgUrl(`/api/organizations/${organizationId}/severities/${severityId}`), { method: 'POST', body: JSON.stringify(data) });
}

export async function updatePriority(organizationId, priorityId, data) {
  return request(orgUrl(`/api/organizations/${organizationId}/priorities/${priorityId}`), { method: 'POST', body: JSON.stringify(data) });
}

export async function updateProduct(organizationId, productId, data) {
  return request(orgUrl(`/api/organizations/${organizationId}/products/${productId}`), { method: 'POST', body: JSON.stringify(data) });
}

export async function updateModule(organizationId, moduleId, data) {
  return request(orgUrl(`/api/organizations/${organizationId}/modules/${moduleId}`), { method: 'POST', body: JSON.stringify(data) });
}

export async function updateRegion(organizationId, regionId, data) {
  return request(orgUrl(`/api/organizations/${organizationId}/regions/${regionId}`), { method: 'POST', body: JSON.stringify(data) });
}

export async function updateEnvironment(organizationId, environmentId, data) {
  return request(orgUrl(`/api/organizations/${organizationId}/environments/${environmentId}`), { method: 'POST', body: JSON.stringify(data) });
}

export async function assignWorkflowToLevel2(organizationId, issueTypeId, workflowId) {
  return request(orgUrl(`/api/organizations/${organizationId}/issue-types/level2/${issueTypeId}/workflow`), {
    method: 'POST',
    body: JSON.stringify({ workflowId })
  });
}

export async function assignSupportPathToLevel2(organizationId, issueTypeId, supportPathId) {
  return request(orgUrl(`/api/organizations/${organizationId}/issue-types/level2/${issueTypeId}/support-path`), {
    method: 'POST',
    body: JSON.stringify({ supportPathId })
  });
}

export async function addIssueTypeCustomField(organizationId, issueTypeId, data) {
  return request(orgUrl(`/api/organizations/${organizationId}/issue-types/level2/${issueTypeId}/custom-fields`), {
    method: 'POST',
    body: JSON.stringify(data)
  });
}

export async function updateIssueTypeCustomField(organizationId, issueTypeId, fieldKey, data) {
  return request(orgUrl(`/api/organizations/${organizationId}/issue-types/level2/${issueTypeId}/custom-fields/${encodeURIComponent(fieldKey)}`), {
    method: 'POST',
    body: JSON.stringify(data)
  });
}

export async function applyIssueTypePreset(organizationId, presetKey) {
  return request(orgUrl(`/api/organizations/${organizationId}/issue-types/presets/${presetKey}`), {
    method: 'POST',
    body: JSON.stringify({})
  });
}

export async function listWorkflows(organizationId) {
  return request(orgUrl(`/api/organizations/${organizationId}/workflows`));
}

export async function getWorkflow(organizationId, workflowId) {
  return request(orgUrl(`/api/organizations/${organizationId}/workflows/${workflowId}`));
}

export async function createWorkflow(organizationId, data) {
  return request(orgUrl(`/api/organizations/${organizationId}/workflows`), {
    method: 'POST',
    body: JSON.stringify(data)
  });
}

export async function applyWorkflowPreset(organizationId, presetKey) {
  return request(orgUrl(`/api/organizations/${organizationId}/workflows/presets/${presetKey}`), {
    method: 'POST',
    body: JSON.stringify({})
  });
}

export async function assignWorkflowToIssueTypes(organizationId, workflowId, issueTypeIds) {
  return request(orgUrl(`/api/organizations/${organizationId}/workflows/${workflowId}/issue-types`), {
    method: 'POST',
    body: JSON.stringify({ issueTypeIds })
  });
}

export async function addWorkflowStatus(organizationId, workflowId, data) {
  return request(orgUrl(`/api/organizations/${organizationId}/workflows/${workflowId}/statuses`), {
    method: 'POST',
    body: JSON.stringify(data)
  });
}

export async function updateWorkflowStatus(organizationId, workflowId, statusId, data) {
  return request(orgUrl(`/api/organizations/${organizationId}/workflows/${workflowId}/statuses/${encodeURIComponent(statusId)}`), {
    method: 'POST',
    body: JSON.stringify(data)
  });
}

export async function updateWorkflowTransitions(organizationId, workflowId, transitions) {
  return request(orgUrl(`/api/organizations/${organizationId}/workflows/${workflowId}/transitions`), {
    method: 'POST',
    body: JSON.stringify({ transitions })
  });
}


export async function addWorkflowStatusTask(organizationId, workflowId, statusId, data) {
  return request(orgUrl(`/api/organizations/${organizationId}/workflows/${workflowId}/statuses/${encodeURIComponent(statusId)}/tasks`), {
    method: 'POST',
    body: JSON.stringify(data)
  });
}

export async function listSupportPaths(organizationId) {
  return request(orgUrl(`/api/organizations/${organizationId}/support-paths`));
}

export async function getSupportPath(organizationId, supportPathId) {
  return request(orgUrl(`/api/organizations/${organizationId}/support-paths/${supportPathId}`));
}

export async function createSupportPath(organizationId, data) {
  return request(orgUrl(`/api/organizations/${organizationId}/support-paths`), {
    method: 'POST',
    body: JSON.stringify(data)
  });
}

export async function applySupportPathPreset(organizationId, presetKey) {
  return request(orgUrl(`/api/organizations/${organizationId}/support-paths/presets/${presetKey}`), {
    method: 'POST',
    body: JSON.stringify({})
  });
}

export async function addSupportPathLevel(organizationId, supportPathId, data) {
  return request(orgUrl(`/api/organizations/${organizationId}/support-paths/${supportPathId}/levels`), {
    method: 'POST',
    body: JSON.stringify(data)
  });
}


export async function updateSupportPathLevel(organizationId, supportPathId, levelId, data) {
  return request(orgUrl(`/api/organizations/${organizationId}/support-paths/${supportPathId}/levels/${encodeURIComponent(levelId)}`), {
    method: 'POST',
    body: JSON.stringify(data)
  });
}


export async function assignWorkflowToSupportLevel(organizationId, supportPathId, levelId, workflowId) {
  return request(orgUrl(`/api/organizations/${organizationId}/support-paths/${supportPathId}/levels/${encodeURIComponent(levelId)}/workflow`), {
    method: 'POST',
    body: JSON.stringify({ workflowId })
  });
}

export async function addSupportPathRule(organizationId, supportPathId, data) {
  return request(orgUrl(`/api/organizations/${organizationId}/support-paths/${supportPathId}/rules`), {
    method: 'POST',
    body: JSON.stringify(data)
  });
}

export async function listClients(organizationId) {
  return request(orgUrl(`/api/organizations/${organizationId}/clients`));
}

export async function suggestClientCode(organizationId, { name = '', shortCode = '', excludeClientId = '' } = {}) {
  const params = new URLSearchParams({ name, shortCode, excludeClientId });
  return request(orgUrl(`/api/organizations/${organizationId}/clients/code/suggest?${params.toString()}`));
}

export async function createClient(organizationId, data) {
  return request(orgUrl(`/api/organizations/${organizationId}/clients`), {
    method: 'POST',
    body: JSON.stringify(data)
  });
}

export async function getClient(organizationId, clientId) {
  return request(orgUrl(`/api/organizations/${organizationId}/clients/${clientId}`));
}

export async function updateClient(organizationId, clientId, data) {
  return request(orgUrl(`/api/organizations/${organizationId}/clients/${clientId}`), {
    method: 'POST',
    body: JSON.stringify(data)
  });
}

export async function deleteClient(organizationId, clientId) {
  return request(orgUrl(`/api/organizations/${organizationId}/clients/${clientId}`), { method: 'DELETE' });
}

export async function updateClientAvailability(organizationId, clientId, data) {
  return request(orgUrl(`/api/organizations/${organizationId}/clients/${clientId}/availability`), {
    method: 'POST',
    body: JSON.stringify(data)
  });
}

export async function createAdminUser(data) {
  return request(`${config.identityServiceUrl}/api/admins`, {
    method: 'POST',
    body: JSON.stringify(data)
  });
}

export async function checkAccountEmailAvailability(email, excludeAdminId = '', organizationId = '') {
  const params = new URLSearchParams({ email, excludeAdminId, organizationId });
  return request(`${config.identityServiceUrl}/api/admins/email-availability?${params.toString()}`);
}

export async function requestAdminEmailChange(adminId, data) {
  return request(`${config.identityServiceUrl}/api/admins/${encodeURIComponent(adminId)}/email-change`, { method: 'POST', body: JSON.stringify(data) });
}

export async function requestUserEmailChange(userId, data) {
  return request(`${config.identityServiceUrl}/api/users/${encodeURIComponent(userId)}/email-change`, { method: 'POST', body: JSON.stringify(data) });
}

export async function validateAdminEmailChange(token) {
  return request(`${config.identityServiceUrl}/api/auth/email-change/validate`, { method: 'POST', body: JSON.stringify({ token }) });
}

export async function completeAdminEmailChange(token) {
  return request(`${config.identityServiceUrl}/api/auth/email-change/complete`, { method: 'POST', body: JSON.stringify({ token }) });
}

export async function listAdmins(organizationId) {
  return request(`${config.identityServiceUrl}/api/admins?organizationId=${encodeURIComponent(organizationId)}`);
}

export async function healthSummary() {
  const checks = [
    ['Web gateway', '/health'],
    ['Organization service', `${config.organizationServiceUrl}/health`],
    ['Identity service', `${config.identityServiceUrl}/health`],
    ['Request service', `${config.requestServiceUrl}/health`]
  ];

  const results = [];
  for (const [name, url] of checks) {
    try {
      const fullUrl = url.startsWith('http') ? url : `http://localhost:${config.port}${url}`;
      const response = await fetch(fullUrl);
      const payload = await response.json();
      results.push({ name, ok: response.ok, status: payload.status || 'unknown' });
    } catch {
      results.push({ name, ok: false, status: 'down' });
    }
  }

  return results;
}

export async function getOperationalConfig(organizationId) {
  return request(orgUrl(`/api/organizations/${organizationId}/config`));
}

export async function seedOperationalConfig(organizationId) {
  return request(orgUrl(`/api/organizations/${organizationId}/config/seed`), {
    method: 'POST',
    body: JSON.stringify({})
  });
}

export async function createSeverity(organizationId, data) {
  return request(orgUrl(`/api/organizations/${organizationId}/severities`), {
    method: 'POST',
    body: JSON.stringify(data)
  });
}

export async function createPriority(organizationId, data) {
  return request(orgUrl(`/api/organizations/${organizationId}/priorities`), {
    method: 'POST',
    body: JSON.stringify(data)
  });
}

export async function createProduct(organizationId, data) {
  return request(orgUrl(`/api/organizations/${organizationId}/products`), {
    method: 'POST',
    body: JSON.stringify(data)
  });
}

export async function createModule(organizationId, data) {
  return request(orgUrl(`/api/organizations/${organizationId}/modules`), {
    method: 'POST',
    body: JSON.stringify(data)
  });
}

export async function createModulesBulk(organizationId, data) {
  return request(orgUrl(`/api/organizations/${organizationId}/modules/bulk`), { method: 'POST', body: JSON.stringify(data) });
}

export async function createRegion(organizationId, data) {
  return request(orgUrl(`/api/organizations/${organizationId}/regions`), {
    method: 'POST',
    body: JSON.stringify(data)
  });
}

export async function createSubregion(organizationId, data) {
  return request(orgUrl(`/api/organizations/${organizationId}/subregions`), { method: 'POST', body: JSON.stringify(data) });
}

export async function updateSubregion(organizationId, subregionId, data) {
  return request(orgUrl(`/api/organizations/${organizationId}/subregions/${subregionId}`), { method: 'POST', body: JSON.stringify(data) });
}

export async function createEnvironment(organizationId, data) {
  return request(orgUrl(`/api/organizations/${organizationId}/environments`), {
    method: 'POST',
    body: JSON.stringify(data)
  });
}

export async function listSlaPolicies(organizationId) {
  return request(orgUrl(`/api/organizations/${organizationId}/slas`));
}

export async function getSlaPolicy(organizationId, slaPolicyId) {
  return request(orgUrl(`/api/organizations/${organizationId}/slas/${slaPolicyId}`));
}

export async function createSlaPolicy(organizationId, data) {
  return request(orgUrl(`/api/organizations/${organizationId}/slas`), {
    method: 'POST',
    body: JSON.stringify(data)
  });
}

export async function applySlaPreset(organizationId, presetKey) {
  return request(orgUrl(`/api/organizations/${organizationId}/slas/presets/${presetKey}`), {
    method: 'POST',
    body: JSON.stringify({})
  });
}

export async function addSlaRule(organizationId, slaPolicyId, data) {
  return request(orgUrl(`/api/organizations/${organizationId}/slas/${slaPolicyId}/rules`), {
    method: 'POST',
    body: JSON.stringify(data)
  });
}

export async function assignClientSlaPolicy(organizationId, clientId, data) {
  return request(orgUrl(`/api/organizations/${organizationId}/clients/${clientId}/sla`), {
    method: 'POST',
    body: JSON.stringify(data)
  });
}

export async function assignClientFamilySlaPolicy(organizationId, clientId, data) {
  return request(orgUrl(`/api/organizations/${organizationId}/clients/${clientId}/sla-family`), {
    method: 'POST',
    body: JSON.stringify(data)
  });
}


export async function updateClientContext(organizationId, clientId, data) {
  return request(orgUrl(`/api/organizations/${organizationId}/clients/${clientId}/context`), {
    method: 'POST',
    body: JSON.stringify(data)
  });
}


export async function addClientOperationalRule(organizationId, clientId, data) {
  return request(orgUrl(`/api/organizations/${organizationId}/clients/${clientId}/operational-rules`), {
    method: 'POST',
    body: JSON.stringify(data)
  });
}

export async function updateClientProducts(organizationId, clientId, data) {
  return request(orgUrl(`/api/organizations/${organizationId}/clients/${clientId}/products`), {
    method: 'POST',
    body: JSON.stringify(data)
  });
}

export async function getOrganizationByWorkspace(workspaceSlug) {
  return request(orgUrl(`/api/organizations/workspace/${encodeURIComponent(workspaceSlug)}`));
}

export async function listUsers(organizationId) {
  return request(`${config.identityServiceUrl}/api/users?organizationId=${encodeURIComponent(organizationId)}`);
}

export async function createUser(data) {
  return request(`${config.identityServiceUrl}/api/users`, {
    method: 'POST',
    body: JSON.stringify(data)
  });
}

export async function updateUser(userId, data) {
  return request(`${config.identityServiceUrl}/api/users/${userId}`, {
    method: 'POST',
    body: JSON.stringify(data)
  });
}

export async function loginActor(data) {
  return request(`${config.identityServiceUrl}/api/auth/login`, {
    method: 'POST',
    body: JSON.stringify(data)
  });
}

export async function validateActivationToken(token) {
  return request(`${config.identityServiceUrl}/api/auth/activation/validate`, { method: 'POST', body: JSON.stringify({ token }) });
}

export async function completeActivation(data) {
  return request(`${config.identityServiceUrl}/api/auth/activation/complete`, { method: 'POST', body: JSON.stringify(data) });
}

export async function requestPasswordReset(data) {
  return request(`${config.identityServiceUrl}/api/auth/password/forgot`, { method: 'POST', body: JSON.stringify(data) });
}

export async function validatePasswordResetToken(token) {
  return request(`${config.identityServiceUrl}/api/auth/password/reset/validate`, { method: 'POST', body: JSON.stringify({ token }) });
}

export async function completePasswordReset(data) {
  return request(`${config.identityServiceUrl}/api/auth/password/reset`, { method: 'POST', body: JSON.stringify(data) });
}

const requestUrl = (path) => `${config.requestServiceUrl}${path}`;

export async function getClientRequestUsage(organizationId, clientId) {
  return request(requestUrl(`/api/organizations/${organizationId}/clients/${clientId}/usage`));
}

export async function listRequests(organizationId, params = {}) {
  const search = new URLSearchParams();
  if (params.clientIds?.length) search.set('clientIds', params.clientIds.join(','));
  if (params.requesterId) search.set('requesterId', params.requesterId);
  if (params.assigneeActorId) search.set('assigneeActorId', params.assigneeActorId);
  if (params.assigneeEmail) search.set('assigneeEmail', params.assigneeEmail);
  if (params.visibilityScopes?.length) search.set('visibilityScopes', params.visibilityScopes.join(','));
  ['page','pageSize','status','sla','supportLevel','visibility','search','dateFrom','dateTo'].forEach((key) => {
    if (params[key] !== undefined && params[key] !== null && String(params[key]).trim() !== '') search.set(key, String(params[key]));
  });
  const suffix = search.toString() ? `?${search.toString()}` : '';
  return request(requestUrl(`/api/organizations/${organizationId}/requests${suffix}`));
}

export async function createServiceRequest(organizationId, data) {
  return request(requestUrl(`/api/organizations/${organizationId}/requests`), {
    method: 'POST',
    body: JSON.stringify(data)
  });
}

export async function getServiceRequest(organizationId, requestId) {
  return request(requestUrl(`/api/organizations/${organizationId}/requests/${requestId}`));
}

export async function changeRequestStatus(organizationId, requestId, data) {
  return request(requestUrl(`/api/organizations/${organizationId}/requests/${requestId}/status`), {
    method: 'POST',
    body: JSON.stringify(data)
  });
}

export async function moveRequestSupportLevel(organizationId, requestId, data) {
  return request(requestUrl(`/api/organizations/${organizationId}/requests/${requestId}/support-move`), {
    method: 'POST',
    body: JSON.stringify(data)
  });
}

export async function assignRequestStage(organizationId, requestId, stageId, data) {
  return request(requestUrl(`/api/organizations/${organizationId}/requests/${requestId}/stages/${encodeURIComponent(stageId)}/assignee`), {
    method: 'POST',
    body: JSON.stringify(data)
  });
}



export async function listRequestTasks(organizationId, params = {}) {
  const search = new URLSearchParams();
  ['page', 'pageSize', 'status', 'supportLevel', 'clientId', 'blocking', 'search', 'visibilityScopes'].forEach((key) => {
    const value = params[key];
    if (value !== undefined && value !== null && String(value).trim() !== '') search.set(key, String(value));
  });
  const suffix = search.toString() ? `?${search.toString()}` : '';
  return request(requestUrl(`/api/organizations/${organizationId}/tasks${suffix}`));
}

export async function getRequestTask(organizationId, taskId) {
  return request(requestUrl(`/api/organizations/${organizationId}/tasks/${encodeURIComponent(taskId)}`));
}

export async function addRequestTaskComment(organizationId, taskId, data) {
  return request(requestUrl(`/api/organizations/${organizationId}/tasks/${encodeURIComponent(taskId)}/comments`), {
    method: 'POST',
    body: JSON.stringify(data)
  });
}

export async function updateRequestTaskStatus(organizationId, requestId, taskId, data) {
  return request(requestUrl(`/api/organizations/${organizationId}/requests/${requestId}/tasks/${encodeURIComponent(taskId)}/status`), {
    method: 'POST',
    body: JSON.stringify(data)
  });
}

export async function closeRequest(organizationId, requestId, data) {
  return request(requestUrl(`/api/organizations/${organizationId}/requests/${requestId}/close`), {
    method: 'POST',
    body: JSON.stringify(data)
  });
}

export async function returnRequest(organizationId, requestId, data) {
  return request(requestUrl(`/api/organizations/${organizationId}/requests/${requestId}/return`), {
    method: 'POST',
    body: JSON.stringify(data)
  });
}


export async function listSavedFilters(organizationId, target = '') {
  const suffix = target ? `?target=${encodeURIComponent(target)}` : '';
  return request(orgUrl(`/api/organizations/${organizationId}/filters${suffix}`));
}

export async function saveSunFilter(organizationId, data) {
  return request(orgUrl(`/api/organizations/${organizationId}/filters`), {
    method: 'POST',
    body: JSON.stringify(data)
  });
}


export async function updateSunFilterVisibility(organizationId, filterId, visibilityScope) {
  return request(orgUrl(`/api/organizations/${organizationId}/filters/${filterId}/visibility`), {
    method: 'POST',
    body: JSON.stringify({ visibilityScope })
  });
}

export async function deleteSunFilter(organizationId, filterId) {
  return request(orgUrl(`/api/organizations/${organizationId}/filters/${filterId}/delete`), {
    method: 'POST',
    body: JSON.stringify({})
  });
}

export async function acknowledgeRequest(organizationId, requestId, data) {
  return request(requestUrl(`/api/organizations/${organizationId}/requests/${requestId}/acknowledge`), {
    method: 'POST',
    body: JSON.stringify(data)
  });
}

export async function addRequestComment(organizationId, requestId, data) {
  return request(requestUrl(`/api/organizations/${organizationId}/requests/${requestId}/comments`), {
    method: 'POST',
    body: JSON.stringify(data)
  });
}

export async function listAuditLogs(organizationId, limit = 200) {
  return request(orgUrl(`/api/organizations/${organizationId}/audit?limit=${encodeURIComponent(limit)}`));
}

export async function createAuditLog(organizationId, data) {
  return request(orgUrl(`/api/organizations/${organizationId}/audit`), {
    method: 'POST',
    body: JSON.stringify(data)
  });
}
