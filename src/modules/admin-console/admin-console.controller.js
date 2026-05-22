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
const { sendBrandedTestEmail } = require('../notifications/notification.service');

const DEFAULT_ISSUE_PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL', 'BLOCKER'];
const DEFAULT_ISSUE_CATEGORIES = ['General', 'Access', 'Billing', 'Configuration', 'Data', 'Integration', 'Performance', 'Security', 'Support', 'Bug'];
const DEFAULT_ISSUE_SOURCES = ['portal', 'email', 'api', 'phone', 'monitoring', 'bulk_upload', 'internal'];
const DEFAULT_REQUEST_TAXONOMY = [
  { key: 'BUG', label: 'Issue', enabled: true, classificationRequired: false, classifications: ['Application Issue', 'Installation Issue', 'Access Issue', 'Data Issue', 'Performance Issue'] },
  { key: 'CR', label: 'Change Request', enabled: true, classificationRequired: false, classifications: ['Enhancement', 'Workflow Change', 'Regulatory Change', 'Report Change'] },
  { key: 'QUERY', label: 'Query', enabled: true, classificationRequired: false, classifications: ['How-to', 'Clarification', 'Configuration Help'] },
  { key: 'SERVICE_REQUEST', label: 'Service Request', enabled: false, classificationRequired: false, classifications: ['Access Request', 'Environment Refresh', 'Report Request', 'Deployment Support'] }
];
const DEFAULT_REGIONS = ['India', 'UAE'];

function parseListInput(value = '') {
  return String(value || '').split(',').map((item) => String(item || '').trim()).filter(Boolean);
}

function getRequestTaxonomy(tenant = null) {
  const configured = Array.isArray(tenant?.issueConfig?.requestTaxonomy) ? tenant.issueConfig.requestTaxonomy : [];
  const byKey = new Map(configured.map((item) => [String(item.key || '').toUpperCase(), item]));
  return DEFAULT_REQUEST_TAXONOMY.map((base) => {
    const item = byKey.get(base.key) || {};
    const classifications = Array.isArray(item.classifications) ? item.classifications.map((x) => String(x || '').trim()).filter(Boolean) : base.classifications;
    return { key: base.key, label: String(item.label || base.label).trim() || base.label, enabled: typeof item.enabled === 'boolean' ? item.enabled : base.enabled, classificationRequired: Boolean(item.classificationRequired), classifications };
  });
}

function getTenantIssueConfig(tenant = null) {
  return {
    priorities: (tenant?.issueConfig?.priorities || DEFAULT_ISSUE_PRIORITIES).filter(Boolean),
    categories: (tenant?.issueConfig?.categories || DEFAULT_ISSUE_CATEGORIES).filter(Boolean),
    sources: (tenant?.issueConfig?.sources || DEFAULT_ISSUE_SOURCES).filter(Boolean),
    regions: (tenant?.issueConfig?.regions || DEFAULT_REGIONS).filter(Boolean),
    requestTaxonomy: getRequestTaxonomy(tenant),
    jiraIssueTypeByRequestType: { bug: String(tenant?.issueConfig?.jiraIssueTypeByRequestType?.bug || 'Bug').trim() || 'Bug', cr: String(tenant?.issueConfig?.jiraIssueTypeByRequestType?.cr || 'Change Request').trim() || 'Change Request', query: String(tenant?.issueConfig?.jiraIssueTypeByRequestType?.query || 'Task').trim() || 'Task', serviceRequest: String(tenant?.issueConfig?.jiraIssueTypeByRequestType?.serviceRequest || 'Service Request').trim() || 'Service Request' }
  };
}

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
    res.render('admin-console/index', { title: 'Admin Console', summary, recentAudit, recentIssues, jiraConnection, tenantSettings: tenant, issueConfig: getTenantIssueConfig(tenant) });
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
          'branding.accentColor': String(req.body.accentColor || '#7C3AED').trim(),
          'notificationConfig.userProvisioningTrackingEmail': String(req.body.userProvisioningTrackingEmail || '').trim().toLowerCase(),
          'issueConfig.priorities': parseListInput(req.body.issuePriorities).length ? parseListInput(req.body.issuePriorities) : DEFAULT_ISSUE_PRIORITIES,
          'issueConfig.categories': parseListInput(req.body.issueCategories).length ? parseListInput(req.body.issueCategories) : DEFAULT_ISSUE_CATEGORIES,
          'issueConfig.sources': parseListInput(req.body.issueSources).length ? parseListInput(req.body.issueSources) : DEFAULT_ISSUE_SOURCES,
          'issueConfig.regions': parseListInput(req.body.issueRegions).length ? parseListInput(req.body.issueRegions) : DEFAULT_REGIONS,
          'issueConfig.jiraIssueTypeByRequestType.bug': String(req.body.jiraIssueTypeBug || 'Bug').trim() || 'Bug',
          'issueConfig.jiraIssueTypeByRequestType.cr': String(req.body.jiraIssueTypeCr || 'Change Request').trim() || 'Change Request',
          'issueConfig.jiraIssueTypeByRequestType.query': String(req.body.jiraIssueTypeQuery || 'Task').trim() || 'Task',
          'issueConfig.jiraIssueTypeByRequestType.serviceRequest': String(req.body.jiraIssueTypeServiceRequest || 'Service Request').trim() || 'Service Request'
        }
      },
      { new: true }
    );
    await logAudit({ tenantId: req.tenant._id, actorUserId: req.currentUser._id, action: 'tenant.settings.updated', entityType: 'tenant', entityId: tenant._id, after: { name: tenant.name, branding: tenant.branding, issueConfig: tenant.issueConfig } });
    req.session.success = 'Tenant settings updated.';
    res.redirect(`${req.basePath}/admin/console`);
  } catch (error) {
    next(error);
  }
}


async function sendTestEmail(req, res, next) {
  try {
    const result = await sendBrandedTestEmail({ tenant: req.tenant, actorUser: req.currentUser, recipientEmail: req.body.recipientEmail || req.currentUser?.email });
    req.session[result.delivered ? 'success' : 'error'] = result.delivered ? `Test email sent to ${result.recipient}.` : `Test email failed: ${result.reason}`;
    res.redirect(`${req.basePath}/admin/console`);
  } catch (error) {
    next(error);
  }
}

async function requestTaxonomyPage(req, res, next) {
  try {
    const tenant = await Tenant.findById(req.tenant._id).lean();
    return res.render('admin-console/request-taxonomy', { title: 'Request Taxonomy', taxonomy: getRequestTaxonomy(tenant) });
  } catch (error) { return next(error); }
}

async function updateRequestTaxonomy(req, res, next) {
  try {
    const taxonomy = DEFAULT_REQUEST_TAXONOMY.map((base) => ({
      key: base.key,
      label: String(req.body[`label_${base.key}`] || base.label).trim() || base.label,
      enabled: req.body[`enabled_${base.key}`] === 'on',
      classificationRequired: req.body[`classificationRequired_${base.key}`] === 'on',
      classifications: parseListInput(req.body[`classifications_${base.key}`]).length ? parseListInput(req.body[`classifications_${base.key}`]) : []
    }));
    await Tenant.findByIdAndUpdate(req.tenant._id, { $set: { 'issueConfig.requestTaxonomy': taxonomy } });
    await logAudit({ tenantId: req.tenant._id, actorUserId: req.currentUser._id, action: 'request_taxonomy.updated', entityType: 'tenant', entityId: req.tenant._id, after: { taxonomy } });
    req.session.success = 'Request taxonomy updated.';
    return res.redirect(`${req.basePath}/admin/console/request-taxonomy`);
  } catch (error) { return next(error); }
}

module.exports = { adminConsolePage, adminConsoleSummaryApi, updateTenantSettings, sendTestEmail, requestTaxonomyPage, updateRequestTaxonomy };
