const { Issue } = require('../issues/issue.model');
const { Entity } = require('../entities/entity.model');
const { User } = require('../users/user.model');
const { RoutingRule } = require('../routing/routing-rule.model');
const { SlaPolicy } = require('../sla/sla-policy.model');
const { StatusMapping } = require('../status-mappings/status-mapping.model');
const { AuditLog } = require('../audit/audit.model');
const { JiraConnection } = require('../integrations/jira/jira-connection.model');
const { Tenant } = require('../tenant/tenant.model');
const { logAudit } = require('../audit/audit.service');

async function getSummary(tenantId) {
  const [
    totalEntities,
    totalClientUsers,
    totalAgents,
    openIssues,
    jiraPending,
    breachedSla,
    internalOnlyIssues,
    recentFailedJiraPushes,
    routingRules,
    slaPolicies,
    statusMappings,
    auditEvents
  ] = await Promise.all([
    Entity.countDocuments({ tenantId }),
    User.countDocuments({ tenantId, role: 'client' }),
    User.countDocuments({ tenantId, role: 'agent' }),
    Issue.countDocuments({ tenantId, status: { $nin: ['RESOLVED', 'CLOSED'] } }),
    Issue.countDocuments({ tenantId, executionMode: 'JIRA', executionState: { $in: ['READY_FOR_EXECUTION', 'FAILED'] } }),
    Issue.countDocuments({ tenantId, $or: [{ 'sla.responseStatus': 'BREACHED' }, { 'sla.resolutionStatus': 'BREACHED' }] }),
    Issue.countDocuments({ tenantId, customerVisibility: 'INTERNAL_ONLY' }),
    Issue.countDocuments({ tenantId, 'jira.pushStatus': 'FAILED' }),
    RoutingRule.countDocuments({ tenantId, isActive: true }),
    SlaPolicy.countDocuments({ tenantId, isActive: true }),
    StatusMapping.countDocuments({ tenantId, isActive: true }),
    AuditLog.countDocuments({ tenantId })
  ]);

  return { totalEntities, totalClientUsers, totalAgents, openIssues, jiraPending, breachedSla, internalOnlyIssues, recentFailedJiraPushes, routingRules, slaPolicies, statusMappings, auditEvents };
}

async function adminConsolePage(req, res, next) {
  try {
    const [summary, recentAudit, recentIssues, jiraConnection, tenant] = await Promise.all([
      getSummary(req.tenant._id),
      AuditLog.find({ tenantId: req.tenant._id }).sort({ createdAt: -1 }).limit(8).populate('actorUserId', 'name email role').lean(),
      Issue.find({ tenantId: req.tenant._id }).sort({ updatedAt: -1 }).limit(8).populate('entityId assignedToUserId', 'name path email').lean(),
      JiraConnection.findOne({ tenantId: req.tenant._id, isActive: true }).lean(),
      Tenant.findById(req.tenant._id).lean()
    ]);
    res.render('admin-console/index', { title: 'Admin Console', summary, recentAudit, recentIssues, jiraConnection, tenantSettings: tenant });
  } catch (error) {
    next(error);
  }
}

async function adminConsoleSummaryApi(req, res, next) {
  try {
    const summary = await getSummary(req.tenant._id);
    res.json({ item: summary });
  } catch (error) {
    next(error);
  }
}

async function updateTenantSettings(req, res, next) {
  try {
    const tenant = await Tenant.findByIdAndUpdate(
      req.tenant._id,
      {
        $set: {
          name: String(req.body.name || req.tenant.name).trim(),
          'branding.supportEmail': String(req.body.supportEmail || '').trim(),
          'branding.accentColor': String(req.body.accentColor || '#7C3AED').trim()
        }
      },
      { new: true }
    );
    await logAudit({ tenantId: req.tenant._id, actorUserId: req.currentUser._id, action: 'tenant.settings.updated', entityType: 'tenant', entityId: tenant._id, after: { name: tenant.name, branding: tenant.branding } });
    req.session.success = 'Tenant settings updated.';
    res.redirect(`${req.basePath}/admin/console`);
  } catch (error) {
    next(error);
  }
}

module.exports = { adminConsolePage, adminConsoleSummaryApi, updateTenantSettings };
