
const { logAudit } = require('../../audit/audit.service');
const {
  getTenantJiraConnection,
  saveTenantJiraConnection,
  validateTenantJiraConnection,
  serializeConnection
} = require('./jira-connection.service');

function isApiRequest(req) {
  return req.originalUrl.startsWith('/api/');
}

async function getJiraConnection(req, res, next) {
  try {
    const connection = await getTenantJiraConnection({ tenantId: req.tenant._id, includeSecret: true });
    if (isApiRequest(req)) return res.json({ item: serializeConnection(connection) });
    return res.render('integrations/jira-config', { title: 'Jira Integration', item: serializeConnection(connection) });
  } catch (error) { return next(error); }
}

async function saveJiraConnection(req, res, next) {
  try {
    if (!req.body.baseUrl || !req.body.email || !req.body.apiToken) {
      const message = 'baseUrl, email and apiToken are required.';
      if (isApiRequest(req)) return res.status(400).json({ error: message });
      req.session.error = message;
      return res.redirect(`${req.basePath}/admin/integrations/jira`);
    }

    const connection = await saveTenantJiraConnection({ tenantId: req.tenant._id, payload: req.body });

    await logAudit({
      tenantId: req.tenant._id,
      actorUserId: req.currentUser._id,
      action: 'jira.connection.saved',
      entityType: 'jira_connection',
      entityId: connection._id,
      after: {
        baseUrl: connection.baseUrl,
        email: connection.email,
        projectKeyDefault: connection.projectKeyDefault,
        issueTypeIdDefault: connection.issueTypeIdDefault,
        issueTypeNameDefault: connection.issueTypeNameDefault,
        webhookSecretConfigured: !!connection.webhookSecret,
        isActive: connection.isActive,
        intake: serializeConnection(connection)?.intake
      }
    });

    if (isApiRequest(req)) return res.json({ item: serializeConnection(connection) });
    req.session.success = 'Jira configuration saved.';
    return res.redirect(`${req.basePath}/admin/integrations/jira`);
  } catch (error) { return next(error); }
}

async function validateJiraConnection(req, res, next) {
  try {
    const { connection, result } = await validateTenantJiraConnection({ tenantId: req.tenant._id });

    await logAudit({
      tenantId: req.tenant._id,
      actorUserId: req.currentUser._id,
      action: 'jira.connection.validated',
      entityType: 'jira_connection',
      entityId: connection?._id,
      after: {
        lastValidationStatus: connection.lastValidationStatus,
        lastValidationMessage: connection.lastValidationMessage,
        lastValidatedAt: connection.lastValidatedAt
      }
    });

    if (isApiRequest(req)) return res.status(result.ok ? 200 : 400).json({ item: serializeConnection(connection), validation: result });
    req.session[result.ok ? 'success' : 'error'] = result.message;
    return res.redirect(`${req.basePath}/admin/integrations/jira`);
  } catch (error) {
    if (isApiRequest(req) && error.status) return res.status(error.status).json({ error: error.message });
    return next(error);
  }
}

module.exports = { getJiraConnection, saveJiraConnection, validateJiraConnection };
