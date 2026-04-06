
const { JiraConnection } = require('./jira-connection.model');
const { normalizeBaseUrl, validateJiraCredentials } = require('./jira.service');

function maskToken(token) {
  if (!token) return '';
  if (token.length <= 8) return '********';
  return `${token.slice(0, 2)}********${token.slice(-2)}`;
}

function serializeConnection(connection) {
  if (!connection) return null;
  return {
    id: String(connection._id),
    tenantId: String(connection.tenantId),
    baseUrl: connection.baseUrl,
    email: connection.email,
    apiTokenMasked: maskToken(connection.apiToken || ''),
    webhookSecretMasked: connection.webhookSecret ? '********' : '',
    intake: {
      minimalMode: !!connection.intake?.minimalMode,
      projectKey: connection.intake?.projectKey || '',
      issueTypeName: connection.intake?.issueTypeName || '',
      defaultStatusAfterPush: connection.intake?.defaultStatusAfterPush || 'PUSHED_TO_JIRA',
      pushAttachments: connection.intake?.pushAttachments !== false,
      isActive: !!connection.intake?.isActive
    },
    projectKeyDefault: connection.projectKeyDefault || '',
    issueTypeIdDefault: connection.issueTypeIdDefault || '',
    issueTypeNameDefault: connection.issueTypeNameDefault || '',
    isActive: !!connection.isActive,
    lastValidatedAt: connection.lastValidatedAt || null,
    lastValidationStatus: connection.lastValidationStatus || 'NEVER_VALIDATED',
    lastValidationMessage: connection.lastValidationMessage || '',
    createdAt: connection.createdAt,
    updatedAt: connection.updatedAt
  };
}

function normalizeProjectKey(projectKey) {
  return String(projectKey || '').trim().toUpperCase();
}

function hasOwn(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj || {}, key);
}

function buildIntakeConfig(payload = {}) {
  const hasExplicitIntake = [
    'intakeMinimalMode',
    'intakeProjectKey',
    'intakeIssueTypeName',
    'intakeDefaultStatusAfterPush',
    'intakePushAttachments',
    'intakeIsActive'
  ].some((key) => hasOwn(payload, key));

  if (!hasExplicitIntake) {
    return {
      minimalMode: false,
      projectKey: '',
      issueTypeName: '',
      defaultStatusAfterPush: 'PUSHED_TO_JIRA',
      pushAttachments: true,
      isActive: false
    };
  }

  const isActive = String(payload.intakeIsActive ?? 'true').toLowerCase() !== 'false';
  return {
    minimalMode: isActive ? String(payload.intakeMinimalMode ?? 'true').toLowerCase() !== 'false' : false,
    projectKey: isActive ? normalizeProjectKey(payload.intakeProjectKey || '') : '',
    issueTypeName: isActive ? (String(payload.intakeIssueTypeName || '').trim() || 'Bug') : '',
    defaultStatusAfterPush: String(payload.intakeDefaultStatusAfterPush || 'PUSHED_TO_JIRA').trim() || 'PUSHED_TO_JIRA',
    pushAttachments: String(payload.intakePushAttachments ?? 'true').toLowerCase() !== 'false',
    isActive
  };
}


async function getTenantJiraConnection({ tenantId, includeSecret = false }) {
  const query = JiraConnection.findOne({ tenantId }).sort({ createdAt: -1 });
  if (includeSecret) query.select('+apiToken +webhookSecret');
  return query;
}

async function saveTenantJiraConnection({ tenantId, payload }) {
  const update = {
    tenantId,
    baseUrl: normalizeBaseUrl(payload.baseUrl),
    email: String(payload.email || '').trim().toLowerCase(),
    apiToken: String(payload.apiToken || '').trim(),
    projectKeyDefault: normalizeProjectKey(payload.projectKeyDefault),
    issueTypeIdDefault: String(payload.issueTypeIdDefault || '').trim(),
    issueTypeNameDefault: String(payload.issueTypeNameDefault || '').trim(),
    webhookSecret: String(payload.webhookSecret || '').trim(),
    intake: buildIntakeConfig(payload),
    isActive: payload.isActive !== false && payload.isActive !== 'false',
    lastValidationStatus: 'NEVER_VALIDATED',
    lastValidationMessage: '',
    lastValidatedAt: null
  };

  let existing = await JiraConnection.findOne({ tenantId }).select('+apiToken');
  if (!existing) {
    existing = await JiraConnection.create(update);
  } else {
    existing.baseUrl = update.baseUrl;
    existing.email = update.email;
    if (update.apiToken) existing.apiToken = update.apiToken;
    existing.webhookSecret = update.webhookSecret;
    existing.projectKeyDefault = update.projectKeyDefault;
    existing.issueTypeIdDefault = update.issueTypeIdDefault;
    existing.issueTypeNameDefault = update.issueTypeNameDefault;
    existing.isActive = update.isActive;
    existing.intake = update.intake;
    existing.lastValidationStatus = 'NEVER_VALIDATED';
    existing.lastValidationMessage = '';
    existing.lastValidatedAt = null;
    await existing.save();
  }
  return getTenantJiraConnection({ tenantId });
}

async function validateTenantJiraConnection({ tenantId }) {
  const connection = await getTenantJiraConnection({ tenantId, includeSecret: true });
  if (!connection) {
    const error = new Error('Jira configuration not found.');
    error.status = 404;
    throw error;
  }
  if (!connection.isActive) {
    const error = new Error('Inactive Jira configuration cannot be validated.');
    error.status = 400;
    throw error;
  }
  try {
    const result = await validateJiraCredentials(connection);
    connection.lastValidatedAt = new Date();
    connection.lastValidationStatus = 'SUCCESS';
    connection.lastValidationMessage = result.message;
    await connection.save();
    return { connection: await getTenantJiraConnection({ tenantId }), result };
  } catch (error) {
    connection.lastValidatedAt = new Date();
    connection.lastValidationStatus = 'FAILED';
    connection.lastValidationMessage = error.message;
    await connection.save();
    return { connection: await getTenantJiraConnection({ tenantId }), result: { ok: false, message: error.message } };
  }
}

module.exports = {
  maskToken,
  serializeConnection,
  normalizeProjectKey,
  getTenantJiraConnection,
  saveTenantJiraConnection,
  validateTenantJiraConnection
};
