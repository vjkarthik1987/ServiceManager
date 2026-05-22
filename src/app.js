const path = require('path');
const mongoose = require('mongoose');
const express = require('express');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const helmet = require('helmet');
const morgan = require('morgan');
const methodOverride = require('method-override');
const compression = require('compression');
const csrf = require('csurf');
const expressLayouts = require('express-ejs-layouts');

const apiRoutes = require('./modules/api/api.routes');
const authRoutes = require('./modules/auth/auth.routes');
const entityRoutes = require('./modules/entities/entity.routes');
const userRoutes = require('./modules/users/user.routes');
const issueRoutes = require('./modules/issues/issue.routes');
const assignmentRoutes = require('./modules/assignments/assignment.routes');
const jiraRoutes = require('./modules/integrations/jira/jira.routes');
const cloudinaryRoutes = require('./modules/integrations/cloudinary/cloudinary.routes');
const jiraFieldMappingRoutes = require('./modules/jira-field-mappings/jira-field-mapping.routes');
const slaRoutes = require('./modules/sla/sla.routes');
const productRoutes = require('./modules/products/product.routes');
const moduleRoutes = require('./modules/modules/module.routes');
const { receiveJiraWebhook } = require('./modules/integrations/jira/jira-webhook.controller');
const { JiraConnection } = require('./modules/integrations/jira/jira-connection.model');

const { attachCurrentUser, requireAuth, requireRole } = require('./middleware/auth');
const { attachTenant, requireTenantMatch } = require('./middleware/tenant');
const { errorHandler, notFoundHandler } = require('./middleware/errorHandler');
const { Issue } = require('./modules/issues/issue.model');
const { getIndicator } = require('./modules/sla/sla.service');
const { Entity } = require('./modules/entities/entity.model');
const { User } = require('./modules/users/user.model');
const { getAccessibleEntityIdsForUser } = require('./utils/access');
const { roleLabel } = require('./utils/roles');
const { WorkflowConfig } = require('./modules/workflows/workflow.model');
const { DEFAULT_CLIENT_STATUS_MAP, getClientStatusPresentation } = require('./modules/workflows/workflow-visibility.service');
const { ensureDefaultTenant } = require('./modules/tenant/tenant.service');
const { Tenant } = require('./modules/tenant/tenant.model');
const { UserEntityMembership } = require('./modules/memberships/membership.model');
const { observeTiming, incMetric, captureError, getMetricsSnapshot } = require('./utils/metrics');
const { logInfo, logError } = require('./utils/logger');

const opsRoutes = require('./modules/ops/ops.routes');
const notificationPreferenceRoutes = require('./modules/notifications/notification-preference.routes');
const notificationRoutes = require('./modules/notifications/notification.routes');
const auditRoutes = require('./modules/audit/audit.routes');
const routingRuleRoutes = require('./modules/routing/routing.routes');
const savedViewRoutes = require('./modules/saved-views/saved-view.routes');
const agentWorkspaceRoutes = require('./modules/agent-workspace/agent-workspace.routes');
const clientPortalRoutes = require('./modules/client-portal/client-portal.routes');
const adminConsoleRoutes = require('./modules/admin-console/admin-console.routes');
const statusMappingRoutes = require('./modules/status-mappings/status-mapping.routes');
const { adminConsoleSummaryApi } = require('./modules/admin-console/admin-console.controller');
const workflowAdminRoutes = require('./modules/workflows/workflow.routes');
const knowledgeRoutes = require('./modules/knowledge/knowledge.routes');
const { KnowledgeDocument } = require('./modules/knowledge/knowledge-document.model');


function normalizeMultiValue(value) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item || '').trim()).filter(Boolean);
  }
  if (value === undefined || value === null || value === '') return [];
  return [String(value).trim()].filter(Boolean);
}

function toObjectIdIfValid(value) {
  const text = String(value || '');
  return mongoose.Types.ObjectId.isValid(text) ? new mongoose.Types.ObjectId(text) : value;
}

function castEntityCriteriaForMongo(filter = {}) {
  const clone = { ...filter };
  if (clone.entityId && clone.entityId.$in) clone.entityId = { $in: clone.entityId.$in.map(toObjectIdIfValid) };
  if (clone.assignedToUserId && clone.assignedToUserId.$in) clone.assignedToUserId = { $in: clone.assignedToUserId.$in.map(toObjectIdIfValid) };
  return clone;
}

function parseDateOnly(value, endOfDay = false) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(String(value))) return null;
  const parsed = new Date(`${value}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function csvEscape(value) {
  if (value === null || value === undefined) return '';
  const stringValue = String(value);
  if (/[\",\n]/.test(stringValue)) {
    return `\"${stringValue.replace(/\"/g, '\"\"')}\"`;
  }
  return stringValue;
}


function rowsToCsv(rows = []) {
  if (!rows.length) return 'No data\n';
  const headers = Array.from(rows.reduce((set, row) => {
    Object.keys(row || {}).forEach((key) => set.add(key));
    return set;
  }, new Set()));
  const lines = [headers.map(csvEscape).join(',')];
  rows.forEach((row) => {
    lines.push(headers.map((header) => csvEscape(row?.[header] ?? '')).join(','));
  });
  return `${lines.join('\n')}\n`;
}


function isClientRole(role) {
  return ['client', 'client_user'].includes(String(role || '').toLowerCase());
}

function isAgentRole(role) {
  return ['agent', 'agent_user'].includes(String(role || '').toLowerCase());
}

function isManagerRole(role) {
  return ['agent_manager', 'engagement_manager', 'regional_head', 'support_head'].includes(String(role || '').toLowerCase());
}

function getReportAudience(user) {
  return isClientRole(user?.role) ? 'client' : 'internal';
}

function buildClientStatusCatalog(workflows = []) {
  const byInternal = new Map();
  Object.keys(DEFAULT_CLIENT_STATUS_MAP).forEach((statusKey) => {
    byInternal.set(statusKey, getClientStatusPresentation(null, statusKey));
  });

  (workflows || []).forEach((workflow) => {
    const defs = Array.isArray(workflow?.statusDefinitions) ? workflow.statusDefinitions : [];
    defs.forEach((item) => {
      const key = String(item?.statusKey || item?.key || item?.status || '').trim().toUpperCase().replace(/\s+/g, '_');
      if (!key) return;
      byInternal.set(key, getClientStatusPresentation(workflow, key));
    });
  });

  const bucketOptions = [
    { value: 'NEW', label: 'Submitted' },
    { value: 'IN_PROGRESS', label: 'We are working on it' },
    { value: 'WAITING_FOR_CLIENT', label: 'Waiting for your input' },
    { value: 'RESOLVED', label: 'Resolved' },
    { value: 'CLOSED', label: 'Closed' }
  ];

  const internalByBucket = new Map(bucketOptions.map((item) => [item.value, new Set()]));
  byInternal.forEach((meta, internalStatus) => {
    const bucket = String(meta?.clientBucket || '').toUpperCase();
    if (!bucket || !internalByBucket.has(bucket)) return;
    internalByBucket.get(bucket).add(internalStatus);
  });

  return {
    byInternal,
    bucketOptions,
    internalByBucket: new Map(Array.from(internalByBucket.entries()).map(([bucket, values]) => [bucket, Array.from(values)]))
  };
}

function collapseRowsByClientBucket(rows = [], clientStatusCatalog, valueFields = []) {
  const bucketOptions = clientStatusCatalog?.bucketOptions || [];
  const order = new Map(bucketOptions.map((item, index) => [item.value, index]));
  const labels = new Map(bucketOptions.map((item) => [item.value, item.label]));
  const grouped = new Map();

  (rows || []).forEach((row) => {
    const internal = String(row?._id || '').toUpperCase();
    const meta = clientStatusCatalog?.byInternal?.get(internal) || getClientStatusPresentation(null, internal);
    const bucket = String(meta?.clientBucket || internal).toUpperCase();
    if (!grouped.has(bucket)) {
      grouped.set(bucket, { _id: bucket, label: labels.get(bucket) || meta?.clientLabel || bucket, count: 0, visits: 0, totalMinutes: 0, excludedMinutes: 0, slaCountedMinutes: 0, weightedAgeSum: 0, maxAgeHours: 0 });
    }
    const target = grouped.get(bucket);
    const count = Number(row?.count || 0);
    target.count += count;
    target.visits += Number(row?.visits || 0);
    valueFields.forEach((field) => {
      target[field] = Number(target[field] || 0) + Number(row?.[field] || 0);
    });
    if (row?.avgAgeHours !== undefined) target.weightedAgeSum += Number(row.avgAgeHours || 0) * count;
    if (row?.maxAgeHours !== undefined) target.maxAgeHours = Math.max(Number(target.maxAgeHours || 0), Number(row.maxAgeHours || 0));
  });

  return Array.from(grouped.values()).map((row) => ({
    ...row,
    avgAgeHours: row.count ? row.weightedAgeSum / row.count : 0,
    avgMinutes: row.visits ? Number(row.totalMinutes || 0) / row.visits : 0
  })).sort((a, b) => (order.get(a._id) ?? 999) - (order.get(b._id) ?? 999));
}


function titleCaseLabel(value = '') {
  return String(value || '')
    .trim()
    .toLowerCase()
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function buildInternalStatusOptions(workflows = []) {
  const fallbackStatuses = ['NEW', 'UNDER_REVIEW', 'GIVEN_FOR_DEVELOPMENT', 'IN_PROGRESS', 'TESTING_DONE', 'WAITING_FOR_CLIENT', 'ANSWERED', 'UAT', 'READY_TO_CLOSE', 'RESOLVED', 'CLOSED'];
  const seen = new Set();
  const options = [];

  (workflows || []).forEach((workflow) => {
    const defs = Array.isArray(workflow?.statusDefinitions) ? workflow.statusDefinitions : [];
    const rawStatuses = [
      ...defs.map((item) => item?.statusKey || item?.key || item?.status || ''),
      ...(Array.isArray(workflow?.statuses) ? workflow.statuses : [])
    ];

    rawStatuses.forEach((value) => {
      const key = String(value || '').trim().toUpperCase().replace(/\s+/g, '_');
      if (!key || seen.has(key)) return;
      seen.add(key);
      const definition = defs.find((item) => String(item?.statusKey || item?.key || item?.status || '').trim().toUpperCase().replace(/\s+/g, '_') === key);
      const label = key === 'READY_TO_CLOSE'
        ? 'Closed for Review'
        : String(definition?.clientLabel || '').trim() || titleCaseLabel(key);
      options.push({ value: key, label });
    });
  });

  if (!options.length) {
    fallbackStatuses.forEach((key) => {
      if (seen.has(key)) return;
      seen.add(key);
      options.push({ value: key, label: key === 'READY_TO_CLOSE' ? 'Closed for Review' : titleCaseLabel(key) });
    });
  }

  const workflowOrder = ['NEW', 'OPEN', 'UNDER_REVIEW', 'ASSIGNED', 'APPROVED', 'IN_PROGRESS', 'WAITING_FOR_CLIENT', 'WAITING_FOR_VENDOR', 'GIVEN_FOR_DEVELOPMENT', 'TESTING', 'TESTING_DONE', 'ANSWERED', 'UAT', 'READY_TO_CLOSE', 'RESOLVED', 'CLOSED'];
  const order = new Map(workflowOrder.map((status, index) => [status, index]));
  return options.sort((a, b) => {
    const left = order.has(a.value) ? order.get(a.value) : 999;
    const right = order.has(b.value) ? order.get(b.value) : 999;
    if (left !== right) return left - right;
    return a.label.localeCompare(b.label);
  });
}

function buildConfiguredPriorityCatalog(tenant = null) {
  const configured = Array.isArray(tenant?.issueConfig?.priorities) ? tenant.issueConfig.priorities : [];
  const fallback = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL', 'BLOCKER'];
  const source = configured.length ? configured : fallback;
  const seen = new Set();
  const options = [];

  source.forEach((item) => {
    const rawLabel = String(item || '').trim();
    if (!rawLabel) return;
    const value = rawLabel.toUpperCase();
    if (seen.has(value)) return;
    seen.add(value);
    options.push({ value, label: configured.length ? rawLabel : titleCaseLabel(rawLabel) });
  });

  const order = new Map(options.map((item, index) => [item.value, index]));
  const labelByValue = new Map(options.map((item) => [item.value, item.label]));
  return { options, order, labelByValue };
}

function buildConfiguredPriorityOptions(tenant = null) {
  return buildConfiguredPriorityCatalog(tenant).options;
}

function formatHoursCompact(totalMinutes = 0) {
  const minutes = Math.max(0, Number(totalMinutes || 0));
  const hours = minutes / 60;
  return hours >= 24 ? `${(hours / 24).toFixed(1)}d` : `${hours.toFixed(1)}h`;
}

function normalizeSeverityRows(rows = [], tenant = null) {
  const catalog = buildConfiguredPriorityCatalog(tenant);
  const countsByValue = new Map();

  (rows || []).forEach((row) => {
    const value = String(row?._id || 'UNSPECIFIED').trim().toUpperCase();
    countsByValue.set(value, Number(countsByValue.get(value) || 0) + Number(row?.count || 0));
  });

  const normalized = catalog.options.map((item) => ({
    _id: item.value,
    label: item.label,
    count: Number(countsByValue.get(item.value) || 0)
  }));

  countsByValue.forEach((count, value) => {
    if (catalog.labelByValue.has(value)) return;
    normalized.push({ _id: value, label: value === 'UNSPECIFIED' ? 'Unspecified' : titleCaseLabel(value), count: Number(count || 0) });
  });

  return normalized
    .filter((row) => row.count > 0 || catalog.labelByValue.has(row._id))
    .sort((a, b) => {
      const left = catalog.order.has(a._id) ? catalog.order.get(a._id) : 999;
      const right = catalog.order.has(b._id) ? catalog.order.get(b._id) : 999;
      if (left !== right) return left - right;
      return String(a.label || a._id).localeCompare(String(b.label || b._id));
    });
}

function normalizeStatusRows(rows = [], statusOptions = []) {
  const order = new Map((statusOptions || []).map((item, index) => [String(item?.value || '').trim().toUpperCase(), index]));
  const labelByValue = new Map((statusOptions || []).map((item) => [String(item?.value || '').trim().toUpperCase(), item.label]));
  const countsByValue = new Map();

  (rows || []).forEach((row) => {
    const value = String(row?._id || 'UNSPECIFIED').trim().toUpperCase();
    countsByValue.set(value, Number(countsByValue.get(value) || 0) + Number(row?.count || 0));
  });

  const normalized = (statusOptions || []).map((item) => ({
    _id: String(item?.value || '').trim().toUpperCase(),
    label: item.label,
    count: Number(countsByValue.get(String(item?.value || '').trim().toUpperCase()) || 0)
  })).filter((row) => row._id);

  countsByValue.forEach((count, value) => {
    if (labelByValue.has(value)) return;
    normalized.push({ _id: value, label: value === 'UNSPECIFIED' ? 'Unspecified' : titleCaseLabel(value), count: Number(count || 0) });
  });

  return normalized
    .filter((row) => row.count > 0 || labelByValue.has(row._id))
    .sort((a, b) => {
      const left = order.has(a._id) ? order.get(a._id) : 999;
      const right = order.has(b._id) ? order.get(b._id) : 999;
      if (left !== right) return left - right;
      return String(a.label || a._id).localeCompare(String(b.label || b._id));
    });
}

function buildStatusSeverityMatrix(rows = [], statusOptions = [], tenant = null) {
  const severityCatalog = buildConfiguredPriorityCatalog(tenant);
  const normalizedStatuses = normalizeStatusRows((rows || []).map((row) => ({ _id: row?._id?.status, count: row?.count })), statusOptions);
  const counts = new Map();

  (rows || []).forEach((row) => {
    const status = String(row?._id?.status || 'UNSPECIFIED').trim().toUpperCase();
    const severity = String(row?._id?.severity || 'UNSPECIFIED').trim().toUpperCase();
    counts.set(`${status}::${severity}`, Number(row?.count || 0));
  });

  const configuredSeverities = normalizeSeverityRows([], tenant);
  const knownSeverityKeys = new Set(configuredSeverities.map((row) => row._id));
  (rows || []).forEach((row) => {
    const severity = String(row?._id?.severity || 'UNSPECIFIED').trim().toUpperCase();
    if (!severity || knownSeverityKeys.has(severity)) return;
    configuredSeverities.push({
      _id: severity,
      label: severity === 'UNSPECIFIED' ? 'Unspecified' : titleCaseLabel(severity),
      count: 0
    });
    knownSeverityKeys.add(severity);
  });

  configuredSeverities.sort((a, b) => {
    const left = severityCatalog.order.has(a._id) ? severityCatalog.order.get(a._id) : 999;
    const right = severityCatalog.order.has(b._id) ? severityCatalog.order.get(b._id) : 999;
    if (left != right) return left - right;
    return String(a.label || a._id).localeCompare(String(b.label || b._id));
  });

  return normalizedStatuses.map((statusRow) => {
    const severities = configuredSeverities.map((severityRow) => ({
      _id: severityRow._id,
      label: severityRow.label,
      count: Number(counts.get(`${statusRow._id}::${severityRow._id}`) || 0)
    }));
    return {
      _id: statusRow._id,
      label: statusRow.label,
      total: Number(statusRow.count || 0),
      severities
    };
  });
}

function buildConfiguredRequestTypeOptions(workflows = []) {
  const configured = (workflows || [])
    .map((workflow) => String(workflow?.issueType || '').trim().toUpperCase())
    .filter(Boolean);

  const fallback = ['BUG', 'CR', 'QUERY', 'SERVICE_REQUEST'];
  const values = Array.from(new Set((configured.length ? configured : fallback)));

  return values.map((value) => ({ value, label: value === 'CR' ? 'Change Request' : value === 'SERVICE_REQUEST' ? 'Service Request' : titleCaseLabel(value) }));
}

function listDateKeysBetween(since, until) {
  const keys = [];
  const cursor = new Date(since);
  cursor.setUTCHours(0, 0, 0, 0);
  const end = new Date(until);
  end.setUTCHours(0, 0, 0, 0);

  while (cursor <= end) {
    keys.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return keys;
}

function buildDailyTrendSeries({ since, until, createdRows = [], closedRows = [] }) {
  const labels = listDateKeysBetween(since, until);
  const createdMap = new Map((createdRows || []).map((row) => [row._id, Number(row.count || 0)]));
  const closedMap = new Map((closedRows || []).map((row) => [row._id, Number(row.count || 0)]));
  return labels.map((label) => ({
    date: label,
    raised: createdMap.get(label) || 0,
    closed: closedMap.get(label) || 0
  }));
}

async function resolveScopedEntityIds({ tenantId, user }) {
  if (!user) return [];
  if (user.role === 'superadmin') {
    const entities = await Entity.find({ tenantId, isActive: true }).select('_id').lean();
    return entities.map((item) => String(item._id));
  }

  const allowed = new Set();

  const directScopedIds = await getAccessibleEntityIdsForUser(user);
  if (Array.isArray(directScopedIds)) {
    directScopedIds.map(String).forEach((id) => allowed.add(id));
  }

  const memberships = await UserEntityMembership.find({ tenantId, userId: user._id, status: 'active' }).populate('entityId');
  const exactIds = memberships.map((membership) => String(membership.entityId?._id || membership.entityId || '')).filter(Boolean);
  exactIds.forEach((id) => allowed.add(id));

  const sourcePaths = memberships
    .map((membership) => String(membership.entityId?.path || ''))
    .filter(Boolean);

  if (sourcePaths.length) {
    const entities = await Entity.find({ tenantId, isActive: true }).select('_id path').lean();
    for (const entity of entities) {
      const path = String(entity.path || '');
      for (const sourcePath of sourcePaths) {
        if (path === sourcePath || path.startsWith(`${sourcePath} / `)) {
          allowed.add(String(entity._id));
          break;
        }
      }
    }
  }

  // Fallbacks so scoped dashboards are not blank when a user's effective work
  // comes from created / assigned issues even if explicit memberships are missing.
  if (isClientRole(user.role) || isAgentRole(user.role)) {
    const issueSideFilter = { tenantId };
    if (isClientRole(user.role)) issueSideFilter.createdByUserId = user._id;
    else issueSideFilter.$or = [{ assignedToUserId: user._id }, { createdByUserId: user._id }];

    const issueScopedEntityIds = await Issue.distinct('entityId', issueSideFilter);
    issueScopedEntityIds.map(String).filter(Boolean).forEach((id) => allowed.add(id));
  }

  return Array.from(allowed);
}

async function buildReportFilters({ tenantId, user, query = {}, scopeIds = [], clientStatusCatalog = null }) {
  const parsedDays = Number.isFinite(Number(query.days)) ? Math.min(Math.max(parseInt(query.days, 10), 1), 365) : 30;
  const fromDate = parseDateOnly(query.fromDate, false);
  const toDate = parseDateOnly(query.toDate, true);
  const reportAudience = getReportAudience(user);

  let since = new Date();
  let until = new Date();
  if (fromDate && toDate && fromDate <= toDate) {
    since = fromDate;
    until = toDate;
  } else if (fromDate && !toDate) {
    since = fromDate;
    until = new Date();
  } else if (!fromDate && toDate) {
    until = toDate;
    since = new Date(toDate);
    since.setUTCDate(since.getUTCDate() - (parsedDays - 1));
    since.setUTCHours(0, 0, 0, 0);
  } else {
    since = new Date();
    since.setHours(0, 0, 0, 0);
    since.setDate(since.getDate() - (parsedDays - 1));
    until = new Date();
  }

  const baseFilter = { tenantId };
  if (user.role !== 'superadmin') {
    if (reportAudience === 'client') {
      baseFilter.$and = [
        {
          $or: [
            ...(Array.isArray(scopeIds) && scopeIds.length ? [{ entityId: { $in: scopeIds } }] : []),
            { createdByUserId: user._id }
          ]
        },
        {
          $or: [
            { customerVisibility: 'VISIBLE_TO_CUSTOMER' },
            { customerVisibility: { $exists: false } },
            { customerVisibility: null },
            { customerVisibility: '' }
          ]
        }
      ];
    } else if (isAgentRole(user.role)) {
      baseFilter.$or = [
        ...(Array.isArray(scopeIds) && scopeIds.length ? [{ entityId: { $in: scopeIds } }] : []),
        { assignedToUserId: user._id },
        { createdByUserId: user._id }
      ];
    } else {
      baseFilter.entityId = { $in: Array.isArray(scopeIds) && scopeIds.length ? scopeIds : [] };
    }
  } else if (reportAudience === 'client') {
    baseFilter.$or = [
      { customerVisibility: 'VISIBLE_TO_CUSTOMER' },
      { customerVisibility: { $exists: false } },
      { customerVisibility: null },
      { customerVisibility: '' }
    ];
  }

  const filter = { ...baseFilter };

  const clientIds = normalizeMultiValue(query.clientId);
  const severities = normalizeMultiValue(query.severity).map((item) => item.toUpperCase());
  const requestTypes = normalizeMultiValue(query.requestType).map((item) => item.toUpperCase());
  const selectedStatuses = normalizeMultiValue(query.status).map((item) => item.toUpperCase());
  const assignedToUserIds = normalizeMultiValue(query.assignedToUserId);
  const executionModes = normalizeMultiValue(query.executionMode).map((item) => item.toUpperCase());
  const slaStates = normalizeMultiValue(query.slaState);

  if (clientIds.length) {
    const allowedScope = Array.isArray(scopeIds) ? scopeIds.map(String) : [];
    const requestedIds = clientIds.map(String);
    const selectedEntities = await Entity.find({ tenantId, _id: { $in: requestedIds }, isActive: true }).select('_id path').lean();
    const selectedPaths = selectedEntities.map((entity) => String(entity.path || '')).filter(Boolean);
    const descendantEntities = selectedPaths.length
      ? await Entity.find({ tenantId, isActive: true, $or: selectedPaths.map((path) => ({ path: { $regex: '^' + path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '( / |$)' } })) }).select('_id').lean()
      : [];
    const expandedIds = Array.from(new Set([...requestedIds, ...descendantEntities.map((entity) => String(entity._id))]));
    filter.entityId = user.role === 'superadmin'
      ? { $in: expandedIds }
      : { $in: expandedIds.filter((id) => allowedScope.includes(id)) };
  }
  if (severities.length) filter.priority = { $in: severities };
  if (requestTypes.length) filter.requestType = { $in: requestTypes };
  if (selectedStatuses.length) {
    if (reportAudience === 'client' && clientStatusCatalog) {
      const internalStatuses = Array.from(new Set(selectedStatuses.flatMap((status) => clientStatusCatalog.internalByBucket.get(status) || [])));
      if (internalStatuses.length) filter.status = { $in: internalStatuses };
      else filter.status = { $in: [] };
    } else {
      filter.status = { $in: selectedStatuses };
    }
  }
  if (executionModes.length) filter.executionMode = { $in: executionModes };
  if (assignedToUserIds.length) filter.assignedToUserId = { $in: assignedToUserIds };
  if (slaStates.length) {
    const mappedSlaStates = [];
    if (slaStates.includes('breached')) mappedSlaStates.push('BREACHED');
    if (slaStates.includes('met')) mappedSlaStates.push('MET');
    if (slaStates.includes('at_risk')) mappedSlaStates.push('AT_RISK');
    if (mappedSlaStates.length) filter['sla.resolutionStatus'] = { $in: mappedSlaStates };
  }

  const periodFilter = {
    ...filter,
    createdAt: { $gte: since, $lte: until }
  };

  const filters = {
    days: parsedDays,
    fromDate: query.fromDate || '',
    toDate: query.toDate || '',
    clientIds,
    severities,
    requestTypes,
    statuses: selectedStatuses,
    assignedToUserIds,
    executionModes,
    slaStates
  };

  const params = new URLSearchParams();
  params.set('days', String(parsedDays));
  if (filters.fromDate) params.set('fromDate', filters.fromDate);
  if (filters.toDate) params.set('toDate', filters.toDate);
  clientIds.forEach((value) => params.append('clientId', value));
  severities.forEach((value) => params.append('severity', value));
  requestTypes.forEach((value) => params.append('requestType', value));
  selectedStatuses.forEach((value) => params.append('status', value));
  assignedToUserIds.forEach((value) => params.append('assignedToUserId', value));
  executionModes.forEach((value) => params.append('executionMode', value));
  slaStates.forEach((value) => params.append('slaState', value));

  const mongoFilter = castEntityCriteriaForMongo(filter);
  const mongoPeriodFilter = { ...mongoFilter, createdAt: periodFilter.createdAt };

  return {
    parsedDays,
    since,
    until,
    baseFilter,
    filter: mongoFilter,
    periodFilter: mongoPeriodFilter,
    filters,
    reportQueryString: params.toString()
  };
}


function mapReportRowsForExport(type, reports) {
  switch (type) {
    case 'summary':
      return [
        { metric: 'Total issues', value: reports.stats.totalIssues },
        { metric: 'Created in period', value: reports.stats.createdInPeriod },
        { metric: 'Open issues', value: reports.stats.openIssues },
        { metric: 'SLA breached', value: reports.stats.slaBreached },
        { metric: 'Waiting for client', value: reports.stats.waitingForClient },
        { metric: 'Jira linked', value: reports.stats.jiraLinked }
      ];
    case 'volume-by-type': return reports.volumeByType.map((row) => ({ type: row._id || 'UNSPECIFIED', count: row.count }));
    case 'volume-by-severity': return reports.volumeBySeverity.map((row) => ({ severity: row.label || row._id || 'UNSPECIFIED', count: row.count }));
    case 'volume-trend': return reports.volumeTrend.map((row) => ({ date: row._id, created: row.count }));
    case 'sla-by-severity': return reports.slaBySeverity.map((row) => ({ severity: row._id || 'UNSPECIFIED', total: row.total, met: row.met, atRisk: row.atRisk, breached: row.breached }));
    case 'status-aging': return reports.statusAging.map((row) => ({ status: row.label || row._id || 'UNSPECIFIED', openCount: row.count, avgAgeHours: Number(row.avgAgeHours || 0).toFixed(1), oldestHours: Number(row.maxAgeHours || 0).toFixed(1) }));
    case 'agent-performance': return reports.agentPerformance.map((row) => ({ agent: row.assigneeName, assigned: row.assignedCount, resolved: row.resolvedCount, breached: row.breachedCount, avgResolutionHours: row.avgResolutionHours ? Number(row.avgResolutionHours).toFixed(1) : '' }));
    case 'jira-execution': return reports.jiraExecution.map((row) => ({ executionState: row._id || 'UNSPECIFIED', total: row.count, linked: row.pushed, failedPushes: row.failed }));
    case 'client-breakdown': return reports.clientBreakdown.map((row) => ({ entity: row.entityPath || row.entityName, total: row.total, open: row.open, breached: row.breached }));
    case 'stage-tracker': return reports.stageTracker.map((row) => ({ status: row.label || row._id || 'UNSPECIFIED', visits: row.visits, totalMinutes: row.totalMinutes, excludedMinutes: row.excludedMinutes, slaCountedMinutes: row.slaCountedMinutes, avgMinutes: Number(row.avgMinutes || 0).toFixed(1) }));
    default: return [];
  }
}


async function buildReportsViewModel({ tenantId, tenant = null, user, query = {} }) {
  const scopeIds = await resolveScopedEntityIds({ tenantId, user });
  const reportAudience = getReportAudience(user);
  const resolvedTenant = await Tenant.findById(tenantId).select('issueConfig').lean();
  const workflows = await WorkflowConfig.find({ tenantId }).lean();
  const clientStatusCatalog = reportAudience === 'client' ? buildClientStatusCatalog(workflows) : null;
  const reportContext = await buildReportFilters({ tenantId, user, query, scopeIds, clientStatusCatalog });
  const { parsedDays, since, until, baseFilter, filter, periodFilter, filters, reportQueryString } = reportContext;
  const openStatuses = reportAudience === 'client'
    ? ['NEW', 'OPEN', 'UNDER_REVIEW', 'APPROVED', 'IN_PROGRESS', 'WAITING_FOR_CLIENT', 'ANSWERED', 'UAT', 'READY_TO_CLOSE', 'GIVEN_FOR_DEVELOPMENT', 'TESTING_DONE'].filter((status) => {
        const presentation = clientStatusCatalog?.byInternal?.get(status) || getClientStatusPresentation(null, status);
        return ['NEW', 'IN_PROGRESS', 'WAITING_FOR_CLIENT'].includes(String(presentation.clientBucket || '').toUpperCase());
      })
    : buildInternalStatusOptions(workflows).map((item) => item.value).filter((status) => !['RESOLVED', 'CLOSED', 'READY_TO_CLOSE'].includes(status));
  const jiraPushFilter = { ...filter, executionMode: 'JIRA' };
  const statusOptions = reportAudience === 'client'
    ? (clientStatusCatalog?.bucketOptions || []).map((item) => ({ value: item.value, label: item.label }))
    : buildInternalStatusOptions(workflows);
  const priorityOptions = buildConfiguredPriorityOptions(resolvedTenant);
  const requestTypeOptions = buildConfiguredRequestTypeOptions(workflows);
  const closedInPeriodMatch = {
    ...baseFilter,
    status: { $in: ['RESOLVED', 'CLOSED', 'READY_TO_CLOSE'] },
    $expr: {
      $and: [
        { $gte: [{ $ifNull: ['$closure.closedAt', '$sla.resolvedAt'] }, since] },
        { $lte: [{ $ifNull: ['$closure.closedAt', '$sla.resolvedAt'] }, until] }
      ]
    }
  };
  const statusLabelByValue = new Map((statusOptions || []).map((item) => [String(item.value || '').toUpperCase(), item.label]));

  const [entities, agents, totalIssues, createdInPeriod, openIssues, slaBreached, waitingForClient, jiraLinked, volumeByType, volumeBySeverity, volumeTrend, closedTrendRows, slaBySeverity, statusAging, statusCounts, statusSeverityBreakdown, agentPerformance, jiraExecution, clientBreakdown, stageTracker, closedStageRows, closedIssueSummaryRows, topClientRows, topAgentRows, productRows, regionRows, agingBucketRows, openBacklogStatusRows, slaRiskRows, workloadRows, openFlowStageRows] = await Promise.all([
    Entity.find(baseFilter.entityId ? { tenantId, _id: { $in: baseFilter.entityId.$in }, isActive: true } : { tenantId, isActive: true }).sort({ path: 1 }).select('_id name path').lean(),
    reportAudience === 'client' ? Promise.resolve([]) : User.find({ tenantId, isActive: true, role: { $in: ['agent', 'agent_user', 'agent_manager', 'support_head', 'superadmin', 'engagement_manager', 'regional_head'] } }).sort({ name: 1 }).select('_id name role').lean(),
    Issue.countDocuments(filter),
    Issue.countDocuments(periodFilter),
    Issue.countDocuments({ ...filter, status: { $in: openStatuses } }),
    Issue.countDocuments({ ...filter, 'sla.resolutionStatus': 'BREACHED' }),
    Issue.countDocuments({ ...filter, status: 'WAITING_FOR_CLIENT' }),
    reportAudience === 'client' ? Promise.resolve(0) : Issue.countDocuments({ ...jiraPushFilter, 'jira.issueKey': { $exists: true, $ne: '' } }),
    Issue.aggregate([{ $match: periodFilter }, { $group: { _id: '$requestType', count: { $sum: 1 } } }, { $sort: { count: -1, _id: 1 } }]),
    Issue.aggregate([{ $match: periodFilter }, { $group: { _id: '$priority', count: { $sum: 1 } } }, { $sort: { count: -1, _id: 1 } }]),
    Issue.aggregate([{ $match: periodFilter }, { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }, count: { $sum: 1 } } }, { $sort: { _id: 1 } }]),
    Issue.aggregate([
      {
        $match: {
          ...filter,
          $or: [
            { 'closure.closedAt': { $gte: since, $lte: until } },
            {
              $and: [
                { 'closure.closedAt': null },
                { status: { $in: ['RESOLVED', 'CLOSED'] } },
                { 'sla.resolvedAt': { $gte: since, $lte: until } }
              ]
            }
          ]
        }
      },
      {
        $project: {
          closedAtEffective: {
            $ifNull: ['$closure.closedAt', '$sla.resolvedAt']
          }
        }
      },
      { $match: { closedAtEffective: { $gte: since, $lte: until } } },
      { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$closedAtEffective' } }, count: { $sum: 1 } } },
      { $sort: { _id: 1 } }
    ]),
    Issue.aggregate([{ $match: { ...filter, 'sla.hasPolicy': true } }, { $group: { _id: { $ifNull: ['$priority', 'UNSPECIFIED'] }, total: { $sum: 1 }, breached: { $sum: { $cond: [{ $eq: ['$sla.resolutionStatus', 'BREACHED'] }, 1, 0] } }, met: { $sum: { $cond: [{ $eq: ['$sla.resolutionStatus', 'MET'] }, 1, 0] } }, atRisk: { $sum: { $cond: [{ $eq: ['$sla.resolutionStatus', 'AT_RISK'] }, 1, 0] } } } }, { $sort: { total: -1, _id: 1 } }]),
    Issue.aggregate([{ $match: { ...filter, status: { $nin: ['RESOLVED', 'CLOSED'] } } }, { $project: { status: 1, ageHours: { $divide: [{ $subtract: [new Date(), '$updatedAt'] }, 1000 * 60 * 60] } } }, { $group: { _id: '$status', count: { $sum: 1 }, avgAgeHours: { $avg: '$ageHours' }, maxAgeHours: { $max: '$ageHours' } } }, { $sort: { avgAgeHours: -1 } }]),
    Issue.aggregate([{ $match: periodFilter }, { $group: { _id: { $ifNull: ['$status', 'UNSPECIFIED'] }, count: { $sum: 1 } } }]),
    Issue.aggregate([{ $match: periodFilter }, { $group: { _id: { status: { $ifNull: ['$status', 'UNSPECIFIED'] }, severity: { $ifNull: ['$priority', 'UNSPECIFIED'] } }, count: { $sum: 1 } } }]),
    reportAudience === 'client' ? Promise.resolve([]) : Issue.aggregate([{ $match: { ...filter, assignedToUserId: { $ne: null } } }, { $group: { _id: '$assignedToUserId', assignedCount: { $sum: 1 }, resolvedCount: { $sum: { $cond: [{ $in: ['$status', ['RESOLVED', 'CLOSED']] }, 1, 0] } }, avgResolutionHours: { $avg: { $cond: [{ $and: [{ $ne: ['$sla.resolvedAt', null] }, { $ne: ['$createdAt', null] }] }, { $divide: [{ $subtract: ['$sla.resolvedAt', '$createdAt'] }, 1000 * 60 * 60] }, null] } }, breachedCount: { $sum: { $cond: [{ $eq: ['$sla.resolutionStatus', 'BREACHED'] }, 1, 0] } } } }, { $lookup: { from: 'users', localField: '_id', foreignField: '_id', as: 'assignee' } }, { $unwind: { path: '$assignee', preserveNullAndEmptyArrays: true } }, { $project: { _id: 0, assigneeId: '$_id', assigneeName: { $ifNull: ['$assignee.name', 'Unassigned'] }, assignedCount: 1, resolvedCount: 1, breachedCount: 1, avgResolutionHours: 1 } }, { $sort: { assignedCount: -1, assigneeName: 1 } }]),
    reportAudience === 'client' ? Promise.resolve([]) : Issue.aggregate([{ $match: jiraPushFilter }, { $group: { _id: '$executionState', count: { $sum: 1 }, pushed: { $sum: { $cond: [{ $ne: ['$jira.issueKey', ''] }, 1, 0] } }, failed: { $sum: { $cond: [{ $eq: ['$jira.pushStatus', 'FAILED'] }, 1, 0] } } } }, { $sort: { count: -1, _id: 1 } }]),
    Issue.aggregate([{ $match: filter }, { $lookup: { from: 'entities', localField: 'entityId', foreignField: '_id', as: 'entity' } }, { $unwind: { path: '$entity', preserveNullAndEmptyArrays: true } }, { $group: { _id: '$entityId', entityName: { $first: { $ifNull: ['$entity.name', 'Unknown entity'] } }, entityPath: { $first: { $ifNull: ['$entity.path', 'Unknown entity'] } }, total: { $sum: 1 }, open: { $sum: { $cond: [{ $in: ['$status', openStatuses] }, 1, 0] } }, breached: { $sum: { $cond: [{ $eq: ['$sla.resolutionStatus', 'BREACHED'] }, 1, 0] } } } }, { $sort: { total: -1, entityName: 1 } }]),
    Issue.aggregate([{ $match: filter }, { $unwind: { path: '$sla.stageStatus', preserveNullAndEmptyArrays: false } }, { $group: { _id: '$sla.stageStatus.status', visits: { $sum: 1 }, totalMinutes: { $sum: { $ifNull: ['$sla.stageStatus.durationMinutes', 0] } }, excludedMinutes: { $sum: { $cond: [{ $or: [{ $eq: ['$sla.stageStatus.excludeFromFinalSla', true] }, { $eq: ['$sla.stageStatus.status', 'WAITING_FOR_CLIENT'] }] }, { $ifNull: ['$sla.stageStatus.durationMinutes', 0] }, 0] } } } }, { $project: { _id: 1, visits: 1, totalMinutes: 1, excludedMinutes: 1, slaCountedMinutes: { $subtract: ['$totalMinutes', '$excludedMinutes'] }, avgMinutes: { $cond: [{ $gt: ['$visits', 0] }, { $divide: ['$totalMinutes', '$visits'] }, 0] } } }, { $sort: { totalMinutes: -1 } }]),
    Issue.aggregate([
      { $match: closedInPeriodMatch },
      { $unwind: { path: '$sla.stageStatus', preserveNullAndEmptyArrays: false } },
      { $project: {
        status: { $ifNull: ['$sla.stageStatus.status', 'UNSPECIFIED'] },
        durationMinutes: { $ifNull: ['$sla.stageStatus.durationMinutes', 0] },
        excluded: { $or: [
          { $eq: ['$sla.stageStatus.excludeFromFinalSla', true] },
          { $eq: ['$sla.stageStatus.status', 'WAITING_FOR_CLIENT'] }
        ] }
      } },
      { $match: { excluded: false } },
      { $group: { _id: '$status', avgMinutes: { $avg: '$durationMinutes' }, totalMinutes: { $sum: '$durationMinutes' }, visits: { $sum: 1 } } },
      { $sort: { avgMinutes: -1, _id: 1 } }
    ]),
    Issue.aggregate([
      { $match: closedInPeriodMatch },
      { $project: {
        countedMinutes: {
          $sum: {
            $map: {
              input: { $ifNull: ['$sla.stageStatus', []] },
              as: 'stage',
              in: {
                $cond: [
                  { $or: [
                    { $eq: ['$$stage.excludeFromFinalSla', true] },
                    { $eq: ['$$stage.status', 'WAITING_FOR_CLIENT'] }
                  ] },
                  0,
                  { $ifNull: ['$$stage.durationMinutes', 0] }
                ]
              }
            }
          }
        },
        waitingMinutes: {
          $sum: {
            $map: {
              input: { $ifNull: ['$sla.stageStatus', []] },
              as: 'stage',
              in: {
                $cond: [
                  { $or: [
                    { $eq: ['$$stage.excludeFromFinalSla', true] },
                    { $eq: ['$$stage.status', 'WAITING_FOR_CLIENT'] }
                  ] },
                  { $ifNull: ['$$stage.durationMinutes', 0] },
                  0
                ]
              }
            }
          }
        }
      } },
      { $group: { _id: null, closedCount: { $sum: 1 }, avgCountedMinutes: { $avg: '$countedMinutes' }, avgWaitingMinutes: { $avg: '$waitingMinutes' }, avgTotalMinutes: { $avg: { $add: ['$countedMinutes', '$waitingMinutes'] } } } }
    ]),
    Issue.aggregate([
      { $match: periodFilter },
      { $lookup: { from: 'entities', localField: 'entityId', foreignField: '_id', as: 'entity' } },
      { $unwind: { path: '$entity', preserveNullAndEmptyArrays: true } },
      { $group: { _id: '$entityId', label: { $first: { $ifNull: ['$entity.name', 'Unknown entity'] } }, count: { $sum: 1 } } },
      { $sort: { count: -1, label: 1 } },
      { $limit: 10 }
    ]),
    reportAudience === 'client' ? Promise.resolve([]) : Issue.aggregate([
      { $match: { ...periodFilter, assignedToUserId: { $ne: null } } },
      { $group: { _id: '$assignedToUserId', count: { $sum: 1 } } },
      { $lookup: { from: 'users', localField: '_id', foreignField: '_id', as: 'agent' } },
      { $unwind: { path: '$agent', preserveNullAndEmptyArrays: true } },
      { $project: { _id: 0, label: { $ifNull: ['$agent.name', 'Unassigned'] }, count: 1 } },
      { $sort: { count: -1, label: 1 } },
      { $limit: 10 }
    ]),
    Issue.aggregate([
      { $match: periodFilter },
      { $project: { productLabel: { $trim: { input: { $ifNull: ['$product', ''] } } } } },
      { $match: { productLabel: { $ne: '' } } },
      { $group: { _id: '$productLabel', label: { $first: '$productLabel' }, count: { $sum: 1 } } },
      { $sort: { count: -1, label: 1 } },
      { $limit: 10 }
    ]),
    Issue.aggregate([
      { $match: periodFilter },
      { $lookup: { from: 'entities', localField: 'entityId', foreignField: '_id', as: 'entity' } },
      { $unwind: { path: '$entity', preserveNullAndEmptyArrays: true } },
      { $project: { regionLabel: { $trim: { input: { $ifNull: ['$entity.metadata.region', ''] } } } } },
      { $match: { regionLabel: { $ne: '' } } },
      { $group: { _id: '$regionLabel', label: { $first: '$regionLabel' }, count: { $sum: 1 } } },
      { $sort: { count: -1, label: 1 } },
      { $limit: 10 }
    ]),
    Issue.aggregate([
      { $match: { ...filter, status: { $in: openStatuses } } },
      { $project: { ageHours: { $divide: [{ $subtract: [new Date(), { $ifNull: ['$updatedAt', '$createdAt'] }] }, 1000 * 60 * 60] } } },
      { $project: { bucket: { $switch: { branches: [
        { case: { $lt: ['$ageHours', 24] }, then: '0-1 day' },
        { case: { $lt: ['$ageHours', 72] }, then: '1-3 days' },
        { case: { $lt: ['$ageHours', 168] }, then: '3-7 days' }
      ], default: '7+ days' } } } },
      { $group: { _id: '$bucket', count: { $sum: 1 } } }
    ]),
    Issue.aggregate([{ $match: { ...filter, status: { $in: openStatuses } } }, { $group: { _id: { $ifNull: ['$status', 'UNSPECIFIED'] }, count: { $sum: 1 } } }]),
    Issue.aggregate([
      { $match: { ...filter, status: { $in: openStatuses }, 'sla.hasPolicy': true } },
      { $project: { riskBucket: { $switch: { branches: [
        { case: { $eq: ['$sla.resolutionStatus', 'BREACHED'] }, then: 'Breached' },
        { case: { $eq: ['$sla.resolutionStatus', 'AT_RISK'] }, then: 'At Risk' }
      ], default: 'Safe' } } } },
      { $group: { _id: '$riskBucket', count: { $sum: 1 } } }
    ]),
    reportAudience === 'client' ? Promise.resolve([]) : Issue.aggregate([
      { $match: { ...filter, status: { $in: openStatuses }, assignedToUserId: { $ne: null } } },
      { $group: { _id: '$assignedToUserId', assignedCount: { $sum: 1 }, breachedCount: { $sum: { $cond: [{ $eq: ['$sla.resolutionStatus', 'BREACHED'] }, 1, 0] } }, atRiskCount: { $sum: { $cond: [{ $eq: ['$sla.resolutionStatus', 'AT_RISK'] }, 1, 0] } } } },
      { $lookup: { from: 'users', localField: '_id', foreignField: '_id', as: 'agent' } },
      { $unwind: { path: '$agent', preserveNullAndEmptyArrays: true } },
      { $project: { _id: 0, label: { $ifNull: ['$agent.name', 'Unassigned'] }, assignedCount: 1, breachedCount: 1, atRiskCount: 1, riskCount: { $add: ['$breachedCount', '$atRiskCount'] }, breachRate: { $cond: [{ $gt: ['$assignedCount', 0] }, { $divide: [{ $add: ['$breachedCount', '$atRiskCount'] }, '$assignedCount'] }, 0] }, overloadScore: { $add: ['$assignedCount', { $multiply: ['$breachedCount', 2] }, '$atRiskCount'] } } },
      { $sort: { overloadScore: -1, label: 1 } },
      { $limit: 8 }
    ]),
    Issue.aggregate([
      { $match: { ...filter, status: { $in: openStatuses } } },
      { $unwind: { path: '$sla.stageStatus', preserveNullAndEmptyArrays: false } },
      { $project: {
        status: { $ifNull: ['$sla.stageStatus.status', 'UNSPECIFIED'] },
        durationMinutes: { $ifNull: ['$sla.stageStatus.durationMinutes', 0] },
        excluded: { $or: [
          { $eq: ['$sla.stageStatus.excludeFromFinalSla', true] },
          { $eq: ['$sla.stageStatus.status', 'WAITING_FOR_CLIENT'] }
        ] }
      } },
      { $match: { excluded: false } },
      { $group: { _id: '$status', avgMinutes: { $avg: '$durationMinutes' }, visits: { $sum: 1 } } },
      { $sort: { avgMinutes: -1, _id: 1 } }
    ])
  ]);

  const closedSlaTrendRows = await Issue.aggregate([
    { $match: closedInPeriodMatch },
    { $project: {
      closedAtEffective: { $ifNull: ['$closure.closedAt', '$sla.resolvedAt'] },
      isBreached: { $eq: ['$sla.resolutionStatus', 'BREACHED'] }
    } },
    { $match: { closedAtEffective: { $gte: since, $lte: until } } },
    { $group: {
      _id: { $dateToString: { format: '%Y-%m-%d', date: '$closedAtEffective' } },
      withinSla: { $sum: { $cond: ['$isBreached', 0, 1] } },
      breachedSla: { $sum: { $cond: ['$isBreached', 1, 0] } }
    } },
    { $sort: { _id: 1 } }
  ]);

  const normalizedStatusAging = reportAudience === 'client'
    ? collapseRowsByClientBucket(statusAging, clientStatusCatalog)
    : statusAging.map((row) => ({ ...row, avgAgeHours: row.avgAgeHours || 0, maxAgeHours: row.maxAgeHours || 0 }));
  const normalizedStatusCounts = reportAudience === 'client'
    ? collapseRowsByClientBucket(statusCounts, clientStatusCatalog)
    : normalizeStatusRows(statusCounts, statusOptions);
  const normalizedStageTracker = reportAudience === 'client'
    ? collapseRowsByClientBucket(stageTracker, clientStatusCatalog, ['totalMinutes', 'excludedMinutes', 'slaCountedMinutes'])
    : stageTracker;
  const issueLifecycleTrend = buildDailyTrendSeries({ since, until, createdRows: volumeTrend, closedRows: closedTrendRows });
  const closedSlaTrendMap = new Map((closedSlaTrendRows || []).map((row) => [String(row._id), row]));
  issueLifecycleTrend.forEach((row) => {
    const slaRow = closedSlaTrendMap.get(String(row.date));
    row.closedWithinSla = Number(slaRow?.withinSla || 0);
    row.closedBreachedSla = Number(slaRow?.breachedSla || 0);
  });
  const normalizedVolumeBySeverity = normalizeSeverityRows(volumeBySeverity, resolvedTenant);
  const normalizedStatusSeverityBreakdown = reportAudience === 'client'
    ? []
    : buildStatusSeverityMatrix(statusSeverityBreakdown, statusOptions, resolvedTenant);
  const closedSlaSummary = Array.isArray(closedIssueSummaryRows) && closedIssueSummaryRows[0]
    ? closedIssueSummaryRows[0]
    : { closedCount: 0, avgCountedMinutes: 0, avgWaitingMinutes: 0, avgTotalMinutes: 0 };
  const closedStageSla = reportAudience === 'client'
    ? []
    : (closedStageRows || []).map((row) => {
        const key = String(row?._id || 'UNSPECIFIED').trim().toUpperCase();
        return {
          _id: key,
          label: statusLabelByValue.get(key) || (key === 'READY_TO_CLOSE' ? 'Closed for Review' : titleCaseLabel(key)),
          avgMinutes: Number(row?.avgMinutes || 0),
          avgHours: Number(row?.avgMinutes || 0) / 60,
          totalMinutes: Number(row?.totalMinutes || 0),
          visits: Number(row?.visits || 0)
        };
      }).sort((a, b) => Number(b.avgMinutes || 0) - Number(a.avgMinutes || 0));

  const agingBucketOrder = ['0-1 day', '1-3 days', '3-7 days', '7+ days'];
  const agingBucketMap = new Map((agingBucketRows || []).map((row) => [String(row?._id || ''), Number(row?.count || 0)]));
  const backlogAging = agingBucketOrder.map((label) => ({ label, count: agingBucketMap.get(label) || 0 }));
  const openBacklogByStatus = reportAudience === 'client'
    ? collapseRowsByClientBucket(openBacklogStatusRows, clientStatusCatalog)
    : normalizeStatusRows(openBacklogStatusRows, statusOptions);
  const slaRiskOrder = ['Safe', 'At Risk', 'Breached'];
  const slaRiskMap = new Map((slaRiskRows || []).map((row) => [String(row?._id || ''), Number(row?.count || 0)]));
  const slaRiskSplit = slaRiskOrder.map((label) => ({ label, count: slaRiskMap.get(label) || 0 }));
  const workloadImbalance = reportAudience === 'client'
    ? []
    : (workloadRows || []).map((row) => ({
        label: row?.label || 'Unassigned',
        assignedCount: Number(row?.assignedCount || 0),
        riskCount: Number(row?.riskCount || 0),
        breachedCount: Number(row?.breachedCount || 0),
        atRiskCount: Number(row?.atRiskCount || 0),
        breachRate: Number(row?.breachRate || 0)
      }));
  const openFlowStageMap = new Map((openFlowStageRows || []).map((row) => [String(row?._id || 'UNSPECIFIED').trim().toUpperCase(), Number(row?.avgMinutes || 0)]));
  const flowEfficiency = (closedStageSla || [])
    .filter((row) => Number(row?.avgMinutes || 0) > 0)
    .map((row) => ({
      label: row.label,
      key: row._id,
      closedHours: Number(row.avgMinutes || 0) / 60,
      openHours: Number(openFlowStageMap.get(String(row._id || '').trim().toUpperCase()) || 0) / 60
    }))
    .filter((row) => row.closedHours > 0 || row.openHours > 0)
    .slice(0, 6);

  return {
    audience: reportAudience,
    appliedDays: parsedDays,
    since,
    until,
    filterMode: filters.fromDate || filters.toDate ? 'date_range' : 'relative_window',
    filters,
    reportQueryString,
    filterOptions: { entities, agents, statuses: statusOptions, priorities: priorityOptions, requestTypes: requestTypeOptions },
    stats: { totalIssues, createdInPeriod, openIssues, slaBreached, waitingForClient, jiraLinked },
    volumeByType,
    volumeBySeverity: normalizedVolumeBySeverity,
    volumeTrend,
    issueLifecycleTrend,
    slaBySeverity,
    statusCounts: normalizedStatusCounts,
    statusSeverityBreakdown: normalizedStatusSeverityBreakdown,
    statusAging: normalizedStatusAging,
    agentPerformance: agentPerformance.map((row) => ({ ...row, avgResolutionHours: row.avgResolutionHours || 0 })),
    jiraExecution,
    clientBreakdown,
    stageTracker: normalizedStageTracker,
    closedSla: {
      summary: {
        closedCount: Number(closedSlaSummary.closedCount || 0),
        avgCountedMinutes: Number(closedSlaSummary.avgCountedMinutes || 0),
        avgWaitingMinutes: Number(closedSlaSummary.avgWaitingMinutes || 0),
        avgTotalMinutes: Number(closedSlaSummary.avgTotalMinutes || 0),
        avgCountedLabel: formatHoursCompact(closedSlaSummary.avgCountedMinutes || 0),
        avgWaitingLabel: formatHoursCompact(closedSlaSummary.avgWaitingMinutes || 0),
        avgTotalLabel: formatHoursCompact(closedSlaSummary.avgTotalMinutes || 0)
      },
      stages: closedStageSla
    },
    dashboardDistributions: {
      topClients: (topClientRows || []).map((row) => ({ _id: row._id, label: row.label || 'Unknown client', count: Number(row.count || 0) })),
      topAgents: (topAgentRows || []).map((row) => ({ _id: row._id, label: row.label || 'Unassigned', count: Number(row.count || 0) })),
      products: (productRows || []).map((row) => ({ _id: row._id, label: row.label || 'Unspecified product', count: Number(row.count || 0) })),
      regions: (regionRows || []).map((row) => ({ _id: row._id, label: row.label || 'Unspecified region', count: Number(row.count || 0) }))
    },
    operationalInsights: {
      backlogAging,
      openBacklogByStatus,
      slaRiskSplit,
      workloadImbalance,
      flowEfficiency
    }
  };
}


function createApp() {

  const app = express();

  const isProduction = process.env.NODE_ENV === 'production';
  const useHttps = String(process.env.USE_HTTPS || 'false') === 'true';
  const trustProxy = String(process.env.TRUST_PROXY || 'false') === 'true';
  const cookieSecure = String(process.env.COOKIE_SECURE || (useHttps || trustProxy ? 'true' : 'false')) === 'true';
  const sessionTtlDays = Math.max(1, Number(process.env.SESSION_TTL_DAYS || 1));
  const mongoUrl = process.env.MONGODB_URI;
  const sessionSecret = process.env.SESSION_SECRET;

  if (!mongoUrl) {
    throw new Error('MONGODB_URI is required.');
  }

  if (!sessionSecret) {
    throw new Error('SESSION_SECRET is required.');
  }

  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, 'views'));
  app.use(expressLayouts);
  app.set('layout', 'layouts/main');

  if (trustProxy || useHttps) {
    app.set('trust proxy', 1);
  }

  app.use(
    helmet({
      contentSecurityPolicy: false
    })
  );

  app.use(compression());

  if (!isProduction) {
    app.use(morgan('dev'));
  }

  app.use((req, res, next) => {
    const startedAt = Date.now();

    res.on('finish', () => {
      const routePath = req.route?.path || req.path || 'unknown';
      observeTiming(`http.${req.method}.${routePath}`, Date.now() - startedAt);
      incMetric(`http.status.${res.statusCode}`);
      logInfo('http_request', {
        method: req.method,
        path: req.originalUrl,
        statusCode: res.statusCode,
        tenantSlug: req.params?.tenantSlug || null,
        userId: req.currentUser?._id ? String(req.currentUser._id) : null
      });
    });

    next();
  });

  app.use(express.urlencoded({ extended: true }));
  app.use(express.json());
  app.use(methodOverride('_method'));
  app.use(express.static(path.join(__dirname, 'public')));

  app.use(
    session({
      secret: sessionSecret,
      resave: false,
      saveUninitialized: false,
      store: MongoStore.create({
        mongoUrl,
        ttl: 60 * 60 * 24 * sessionTtlDays,
        autoRemove: 'native'
      }),
      cookie: {
        httpOnly: true,
        sameSite: 'lax',
        secure: cookieSecure,
        maxAge: 1000 * 60 * 60 * 24 * sessionTtlDays
      }
    })
  );

  app.use((req, res, next) => {
    res.locals.success = req.session.success || null;
    res.locals.error = req.session.error || null;
    delete req.session.success;
    delete req.session.error;
    next();
  });

  // Attach once globally.
  app.use(attachTenant);
  app.use(attachCurrentUser);

  const csrfProtection = csrf();

  app.use((req, res, next) => {
    const isApiRequest = req.path.startsWith('/api/');
    const bypassForTests =
      process.env.NODE_ENV === 'test' && req.headers['x-test-bypass-csrf'] === '1';
    const isMultipart = (req.headers['content-type'] || '').includes('multipart/form-data');

    if (isApiRequest || bypassForTests || isMultipart) {
      return next();
    }

    return csrfProtection(req, res, next);
  });

  app.use(async (req, res, next) => {
    res.locals.csrfToken = typeof req.csrfToken === 'function' ? req.csrfToken() : null;
    res.locals.currentUser = req.currentUser || null;
    res.locals.tenant = req.tenant || null;
    res.locals.basePath = req.basePath || (req.tenant ? `/${req.tenant.slug}` : '');
    res.locals.apiBasePath = req.apiBasePath || (req.tenant ? `/api/v1/${req.tenant.slug}` : '/api/v1');
    res.locals.currentPath = req.originalUrl || req.url || '';
    res.locals.unreadNotificationCount = 0;
    res.locals.unassignedIssueCount = 0;
    res.locals.appVersion = 'v35.0.0';
    try {
      if (req.currentUser && ['agent_manager', 'support_head', 'superadmin'].includes(req.currentUser.role) && req.tenant) {
        const unassignedFilter = { tenantId: req.tenant._id, assignedToUserId: null, status: { $nin: ['CLOSED'] } };
        if (req.currentUser.role !== 'superadmin') {
          const allowed = await getAccessibleEntityIdsForUser(req.currentUser);
          unassignedFilter.entityId = { $in: Array.isArray(allowed) ? allowed : [] };
        }
        res.locals.unassignedIssueCount = await Issue.countDocuments(unassignedFilter);
      }
    } catch (_) { res.locals.unassignedIssueCount = 0; }
    next();
  });

  app.get('/health', (req, res) => {
    res.json({
      status: 'ok',
      version: 'v37.0.0',
      metrics: getMetricsSnapshot()
    });
  });

  app.get('/', async (req, res, next) => {
    try {
      const tenant = await ensureDefaultTenant();

      if (!req.currentUser) {
        return res.redirect(`/${tenant.slug}/login`);
      }

      const targetBase = `/${req.session.tenantSlug || tenant.slug}`;
      return res.redirect(
        req.currentUser.role === 'client'
          ? `${targetBase}/client/dashboard`
          : `${targetBase}/dashboard`
      );
    } catch (error) {
      return next(error);
    }
  });

  app.use('/', authRoutes);

  app.get('/:tenantSlug', (req, res) => {
    if (!req.currentUser) {
      return res.redirect(`${req.basePath}/login`);
    }

    return res.redirect(
      req.currentUser.role === 'client'
        ? `${req.basePath}/client/dashboard`
        : `${req.basePath}/dashboard`
    );
  });

  app.get('/:tenantSlug/dashboard', requireTenantMatch, requireAuth, async (req, res, next) => {
    try {
      if (req.currentUser.role === 'client') {
        return res.redirect(`${req.basePath}/client/dashboard`);
      }

      const issueFilter = { tenantId: req.tenant._id };
      let scopedEntities = [];

      if (req.currentUser.role !== 'superadmin') {
        const scopeIds = await resolveScopedEntityIds({ tenantId: req.tenant._id, user: req.currentUser });
        issueFilter.entityId = { $in: scopeIds.length ? scopeIds : [] };
        scopedEntities = scopeIds.length
          ? await Entity.find({ tenantId: req.tenant._id, _id: { $in: scopeIds }, isActive: true }).select('name path acronym type').sort({ path: 1 }).lean()
          : [];
      }

      const startOfToday = new Date();
      startOfToday.setHours(0, 0, 0, 0);

      const [
        issuesCount,
        recentIssues,
        entitiesCount,
        usersCount,
        agentsCount,
        clientsCount,
        slaBreachedIssues,
        slaAtRiskIssues,
        jiraConnection,
        openIssuesCount,
        jiraLinkedIssuesCount,
        jiraQueueCount,
        updatedTodayCount,
        attentionIssues,
        calendarIssues
      ] = await Promise.all([
        Issue.countDocuments(issueFilter),
        Issue.find(issueFilter)
          .select('issueNumber title entityId status jira priority assignedToUserId createdByUserId createdAt sla closure')
          .populate('entityId', 'name path acronym type')
          .populate('assignedToUserId', 'name email role')
          .populate('createdByUserId', 'name email role')
          .sort({ createdAt: -1 })
          .limit(15)
          .lean(),
        req.currentUser.role === 'superadmin'
          ? Entity.countDocuments({ tenantId: req.tenant._id })
          : Promise.resolve(null),
        req.currentUser.role === 'superadmin'
          ? User.countDocuments({ tenantId: req.tenant._id })
          : Promise.resolve(null),
        req.currentUser.role === 'superadmin'
          ? User.countDocuments({ tenantId: req.tenant._id, role: { $in: ['agent', 'agent_user', 'agent_manager', 'support_head'] } })
          : Promise.resolve(null),
        req.currentUser.role === 'superadmin'
          ? User.countDocuments({ tenantId: req.tenant._id, role: 'client' })
          : Promise.resolve(null),
        Issue.countDocuments({
          ...issueFilter,
          $or: [{ 'sla.responseStatus': 'BREACHED' }, { 'sla.resolutionStatus': 'BREACHED' }]
        }),
        Issue.countDocuments({
          ...issueFilter,
          $or: [{ 'sla.responseStatus': 'AT_RISK' }, { 'sla.resolutionStatus': 'AT_RISK' }]
        }),
        JiraConnection.findOne({ tenantId: req.tenant._id, isActive: true }).lean(),
        Issue.countDocuments({
          ...issueFilter,
          status: { $in: ['NEW', 'OPEN', 'IN_PROGRESS', 'WAITING_FOR_CLIENT', 'READY_TO_CLOSE'] }
        }),
        Issue.countDocuments({
          ...issueFilter,
          'jira.issueKey': { $exists: true, $ne: '' }
        }),
        Issue.countDocuments({
          ...issueFilter,
          executionMode: 'JIRA',
          $or: [
            { executionState: 'READY_FOR_EXECUTION' },
            { 'jira.outboundState': 'QUEUED' },
            { 'jira.pushStatus': 'NOT_PUSHED' }
          ]
        }),
        Issue.countDocuments({
          ...issueFilter,
          updatedAt: { $gte: startOfToday }
        }),
        Issue.find({
          ...issueFilter,
          status: { $in: ['NEW', 'OPEN', 'UNDER_REVIEW', 'ASSIGNED', 'IN_PROGRESS', 'WAITING_FOR_CLIENT', 'READY_TO_CLOSE'] }
        })
          .select('issueNumber title entityId status priority assignedToUserId createdAt updatedAt sla jira closure')
          .populate('entityId', 'name path acronym type')
          .populate('assignedToUserId', 'name email role')
          .sort({ updatedAt: 1 })
          .limit(40)
          .lean(),
        Issue.find(issueFilter)
          .select('issueNumber title entityId status priority assignedToUserId createdAt updatedAt sla closure requestType')
          .populate('entityId', 'name path acronym type')
          .populate('assignedToUserId', 'name email role')
          .sort({ updatedAt: -1 })
          .limit(220)
          .lean()
      ]);

      recentIssues.forEach((issue) => {
        if (issue.sla) {
          issue.sla.responseStatus = getIndicator({
            dueAt: issue.sla.responseDueAt,
            completedAt: issue.sla.firstRespondedAt,
            warningThresholdPercent: issue.sla.warningThresholdPercent,
            startedAt: issue.createdAt
          });

          issue.sla.resolutionStatus = getIndicator({
            dueAt: issue.sla.resolutionDueAt,
            completedAt: issue.sla.resolvedAt,
            warningThresholdPercent: issue.sla.warningThresholdPercent,
            startedAt: issue.createdAt
          });
        }
      });


      const attentionItems = (attentionIssues || [])
        .map((issue) => {
          const resolutionDueAt = issue.sla?.resolutionDueAt ? new Date(issue.sla.resolutionDueAt) : null;
          const minutesToBreach = resolutionDueAt ? Math.round((resolutionDueAt.getTime() - Date.now()) / 60000) : null;
          let level = 'normal';
          let reason = 'Needs next action';
          if (issue.sla?.resolutionStatus === 'BREACHED' || (minutesToBreach !== null && minutesToBreach < 0)) {
            level = 'breached';
            reason = 'SLA breached';
          } else if (issue.sla?.resolutionStatus === 'AT_RISK' || (minutesToBreach !== null && minutesToBreach <= 120)) {
            level = 'risk';
            reason = minutesToBreach !== null ? `SLA due in ${Math.max(minutesToBreach, 0)} min` : 'SLA at risk';
          } else if (String(issue.status || '').toUpperCase() === 'WAITING_FOR_CLIENT') {
            level = 'waiting';
            reason = 'Waiting for client input';
          } else if (String(issue.status || '').toUpperCase() === 'READY_TO_CLOSE') {
            level = 'ready';
            reason = 'Ready for closure';
          } else if (!issue.assignedToUserId && ['NEW', 'OPEN', 'UNDER_REVIEW'].includes(String(issue.status || '').toUpperCase())) {
            level = 'risk';
            reason = 'Unassigned intake';
          }
          const ageHours = Math.max(0, Math.round((Date.now() - new Date(issue.updatedAt || issue.createdAt || Date.now()).getTime()) / 3600000));
          return {
            _id: issue._id,
            issueNumber: issue.issueNumber,
            title: issue.title,
            status: issue.status,
            priority: issue.priority,
            entity: issue.entityId?.path || issue.entityId?.name || 'Unassigned entity',
            assignee: issue.assignedToUserId?.name || 'Unassigned',
            reason,
            level,
            ageHours,
            score: (level === 'breached' ? 500 : level === 'risk' ? 300 : level === 'waiting' ? 120 : 80) + (issue.priority === 'CRITICAL' || issue.priority === 'HIGH' ? 60 : 0) + Math.min(ageHours, 120)
          };
        })
        .sort((a, b) => b.score - a.score)
        .slice(0, 12);



      const sourceForCalendar = (calendarIssues && calendarIssues.length ? calendarIssues : (attentionIssues || recentIssues || []));
      const resolutionCalendar = sourceForCalendar
        .filter((issue) => issue && (issue.sla?.resolutionDueAt || issue.sla?.resolvedAt || issue.updatedAt || issue.createdAt))
        .map((issue) => {
          const isClosed = ['RESOLVED', 'CLOSED', 'READY_TO_CLOSE'].includes(String(issue.status || '').toUpperCase());
          const target = issue.sla?.resolutionDueAt
            ? new Date(issue.sla.resolutionDueAt)
            : new Date(issue.sla?.resolvedAt || issue.updatedAt || issue.createdAt || Date.now());
          const status = issue.sla?.resolutionStatus || (isClosed ? 'CLOSED' : 'NO_SLA');
          return {
            _id: issue._id,
            issueNumber: issue.issueNumber,
            title: issue.title,
            date: target.toISOString().slice(0, 10),
            status,
            priority: issue.priority || '',
            requestType: issue.requestType || 'BUG',
            workflowStatus: issue.status || '',
            entity: issue.entityId?.path || issue.entityId?.name || '',
            assignee: issue.assignedToUserId?.name || 'Unassigned',
            isClosed,
            isWithinSla: isClosed && status !== 'BREACHED',
            isBreached: status === 'BREACHED',
            isAtRisk: status === 'AT_RISK'
          };
        })
        .sort((a, b) => String(a.date).localeCompare(String(b.date)));

      return res.render('dashboard/index', {
        title: 'Home',
        stats: {
          issuesCount,
          entitiesCount,
          usersCount,
          agentsCount,
          clientsCount,
          slaBreachedIssues,
          slaAtRiskIssues,
          openIssuesCount,
          jiraLinkedIssuesCount,
          jiraQueueCount,
          updatedTodayCount
        },
        recentIssues,
        attentionItems,
        resolutionCalendar,
        jiraConnection,
        scopedEntities
      });
    } catch (error) {
      return next(error);
    }
  });



app.get('/:tenantSlug/dashboards', requireTenantMatch, requireAuth, requireRole(['superadmin', 'agent', 'agent_user', 'agent_manager', 'support_head', 'regional_head', 'engagement_manager', 'client', 'client_user']), async (req, res, next) => {
  try {
    const reports = await buildReportsViewModel({ tenantId: req.tenant._id, tenant: req.tenant, user: req.currentUser, query: req.query });
    let dashboardRole = 'admin';
    if (isClientRole(req.currentUser?.role)) dashboardRole = 'client';
    else if (isAgentRole(req.currentUser?.role)) dashboardRole = 'agent';
    else if (isManagerRole(req.currentUser?.role)) dashboardRole = 'manager';
    return res.render('dashboards/index', {
      title: 'Dashboards',
      reports,
      dashboardRole
    });
  } catch (error) {
    return next(error);
  }
});

  app.get('/:tenantSlug/reports', requireTenantMatch, requireAuth, requireRole(['superadmin', 'agent', 'agent_user', 'agent_manager', 'support_head', 'regional_head', 'client', 'client_user']), async (req, res, next) => {
    try {
      const reports = await buildReportsViewModel({ tenantId: req.tenant._id, tenant: req.tenant, user: req.currentUser, query: req.query });
      return res.render('reports/index', {
        title: 'Reports',
        reports
      });
    } catch (error) {
      return next(error);
    }
  });


  app.get('/:tenantSlug/reports/export/issues.csv', requireTenantMatch, requireAuth, requireRole(['superadmin', 'agent', 'agent_user', 'agent_manager', 'support_head', 'regional_head', 'client', 'client_user']), async (req, res, next) => {
    try {
      const scopeIds = await resolveScopedEntityIds({ tenantId: req.tenant._id, user: req.currentUser });
      const reportAudience = getReportAudience(req.currentUser);
      const workflows = reportAudience === 'client' ? await WorkflowConfig.find({ tenantId: req.tenant._id }).lean() : [];
      const clientStatusCatalog = reportAudience === 'client' ? buildClientStatusCatalog(workflows) : null;
      const { periodFilter } = await buildReportFilters({ tenantId: req.tenant._id, user: req.currentUser, query: req.query, scopeIds, clientStatusCatalog });
      const issues = await Issue.find(periodFilter)
        .populate('entityId', 'name path')
        .populate('assignedToUserId', 'name email role')
        .populate('createdByUserId', 'name email')
        .sort({ createdAt: -1 })
        .lean();

      const rows = issues.map((issue) => ({
        issueNumber: issue.issueNumber,
        issueLink: `${req.protocol}://${req.get('host')}${req.basePath}/tickets/${issue._id}`,
        title: issue.title,
        description: issue.description || '',
        entity: issue.entityId?.path || issue.entityId?.name || '',
        status: reportAudience === 'client' ? ((clientStatusCatalog?.byInternal?.get(String(issue.status || '').toUpperCase()) || getClientStatusPresentation(null, issue.status)).clientLabel) : issue.status,
        priority: issue.priority,
        requestType: issue.requestType,
        executionMode: issue.executionMode,
        assignedTo: issue.assignedToUserId?.name || issue.assignedToUserId?.email || '',
        createdBy: issue.createdByUserId?.name || issue.createdByUserId?.email || '',
        jiraIssueKey: issue.jira?.issueKey || '',
        rcaRootCause: issue.closure?.rca?.rootCause || '',
        rcaResolutionSummary: issue.closure?.rca?.resolutionSummary || '',
        slaResolutionStatus: issue.sla?.resolutionStatus || '',
        createdAt: issue.createdAt ? new Date(issue.createdAt).toISOString() : '',
        updatedAt: issue.updatedAt ? new Date(issue.updatedAt).toISOString() : ''
      }));

      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="issues-report.csv"');
      return res.send(rowsToCsv(rows));
    } catch (error) {
      return next(error);
    }
  });

  app.get('/:tenantSlug/reports/export/card.csv', requireTenantMatch, requireAuth, requireRole(['superadmin', 'agent', 'agent_user', 'agent_manager', 'support_head', 'regional_head', 'client', 'client_user']), async (req, res, next) => {
    try {
      const reports = await buildReportsViewModel({ tenantId: req.tenant._id, tenant: req.tenant, user: req.currentUser, query: req.query });
      const rows = mapReportRowsForExport(String(req.query.type || ''), reports);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${String(req.query.type || 'report').replace(/[^a-z0-9_-]+/gi, '-')}.csv"`);
      return res.send(rowsToCsv(rows));
    } catch (error) {
      return next(error);
    }
  });

  app.post('/api/v1/:tenantSlug/integrations/jira/webhook', requireTenantMatch, receiveJiraWebhook);

  app.use('/api/v1/:tenantSlug', requireTenantMatch, apiRoutes);
  app.use('/api/v1', requireTenantMatch, apiRoutes);

  app.use('/:tenantSlug/entities', requireTenantMatch, requireAuth, entityRoutes);
  app.use('/:tenantSlug/users', requireTenantMatch, requireAuth, requireRole(['superadmin','agent_manager','support_head','regional_head','engagement_manager','agent','agent_user','client','client_user']), userRoutes);
  app.use('/:tenantSlug/admin/users', requireTenantMatch, requireAuth, requireRole(['superadmin']), userRoutes);
  app.use('/:tenantSlug/admin/entities', requireTenantMatch, requireAuth, requireRole(['superadmin']), entityRoutes);
  app.use('/:tenantSlug/assignments', requireTenantMatch, requireAuth, requireRole(['superadmin']), assignmentRoutes);

  app.use('/:tenantSlug/admin/console', requireTenantMatch, requireAuth, requireRole(['superadmin']), adminConsoleRoutes);
  app.get('/api/v1/:tenantSlug/admin/console/summary', requireTenantMatch, requireAuth, requireRole(['superadmin']), adminConsoleSummaryApi);
  app.use('/:tenantSlug/admin/integrations/jira', requireTenantMatch, requireAuth, requireRole(['superadmin']), jiraRoutes);
  app.use('/:tenantSlug/admin/integrations/cloudinary', requireTenantMatch, requireAuth, requireRole(['superadmin']), cloudinaryRoutes);
  app.use('/:tenantSlug/admin/jira-field-mappings', requireTenantMatch, requireAuth, requireRole(['superadmin']), jiraFieldMappingRoutes);
  app.use('/:tenantSlug/admin/sla-policies', requireTenantMatch, requireAuth, requireRole(['superadmin']), slaRoutes);
  app.use('/:tenantSlug/admin/routing-rules', requireTenantMatch, requireAuth, requireRole(['superadmin']), routingRuleRoutes);
  app.use('/:tenantSlug/admin/products', requireTenantMatch, requireAuth, requireRole(['superadmin']), productRoutes);
  app.use('/:tenantSlug/admin/modules', requireTenantMatch, requireAuth, requireRole(['superadmin']), moduleRoutes);
  app.use('/:tenantSlug/admin/notification-preferences', requireTenantMatch, requireAuth, notificationPreferenceRoutes);
  app.use('/:tenantSlug/admin/notifications', requireTenantMatch, requireAuth, notificationRoutes);
  app.use('/:tenantSlug/admin/saved-views', requireTenantMatch, requireAuth, savedViewRoutes);
  app.use('/:tenantSlug/filters', requireTenantMatch, requireAuth, savedViewRoutes);
  app.use('/:tenantSlug/admin/workflows', requireTenantMatch, requireAuth, requireRole(['superadmin']), workflowAdminRoutes);
  app.use('/:tenantSlug/admin/audit', requireTenantMatch, requireAuth, requireRole(['superadmin']), auditRoutes);
  app.use('/:tenantSlug/admin/status-mappings', requireTenantMatch, requireAuth, requireRole(['superadmin']), statusMappingRoutes);
  app.use('/:tenantSlug/admin/knowledge', requireTenantMatch, requireAuth, requireRole(['superadmin']), knowledgeRoutes);
  app.use('/:tenantSlug/knowledge', requireTenantMatch, requireAuth, requireRole(['superadmin','agent','agent_user','agent_manager','support_head','regional_head','engagement_manager','client','client_user']), knowledgeRoutes);

  app.get('/:tenantSlug/admin/automation', requireTenantMatch, requireAuth, requireRole(['superadmin','agent_manager','support_head']), async (req, res, next) => {
    try {
      const [autoCandidates, duplicateClusters, kbDrafts, healthRows] = await Promise.all([
        Issue.find({ tenantId: req.tenant._id, status: { $in: ['NEW','OPEN','REOPENED'] }, 'sla.resolutionStatus': { $ne: 'BREACHED' } })
          .populate('entityId assignedToUserId', 'name path email')
          .sort({ updatedAt: -1 })
          .limit(25)
          .lean(),
        Issue.aggregate([
          { $match: { tenantId: req.tenant._id, status: { $nin: ['CLOSED'] } } },
          { $project: { key: { $toLower: { $substrCP: ['$title', 0, 32] } }, issueNumber: 1, title: 1, status: 1, priority: 1 } },
          { $group: { _id: '$key', count: { $sum: 1 }, issues: { $push: { issueNumber: '$issueNumber', title: '$title', status: '$status', priority: '$priority' } } } },
          { $match: { count: { $gt: 1 } } },
          { $sort: { count: -1 } },
          { $limit: 10 }
        ]),
        KnowledgeDocument.find({ tenantId: req.tenant._id, sourceType: { $in: ['AUTO_KB_DRAFT','RUNBOOK_DRAFT'] } }).sort({ updatedAt: -1 }).limit(20).lean(),
        Issue.aggregate([
          { $match: { tenantId: req.tenant._id } },
          { $group: { _id: '$entityId', total: { $sum: 1 }, open: { $sum: { $cond: [{ $in: ['$status', ['NEW','OPEN','IN_PROGRESS','WAITING_FOR_CLIENT','REOPENED']] }, 1, 0] } }, breached: { $sum: { $cond: [{ $eq: ['$sla.resolutionStatus','BREACHED'] }, 1, 0] } }, reopened: { $sum: { $cond: [{ $eq: ['$status','REOPENED'] }, 1, 0] } } } },
          { $lookup: { from: 'entities', localField: '_id', foreignField: '_id', as: 'entity' } },
          { $unwind: { path: '$entity', preserveNullAndEmptyArrays: true } },
          { $project: { label: { $ifNull: ['$entity.name','Unknown client'] }, total: 1, open: 1, breached: 1, reopened: 1, score: { $max: [0, { $subtract: [100, { $add: [{ $multiply: ['$breached', 12] }, { $multiply: ['$reopened', 6] }, { $multiply: ['$open', 1] }] }] }] } } },
          { $sort: { score: 1, label: 1 } },
          { $limit: 20 }
        ])
      ]);
      return res.render('ops/automation', { title: 'AI Automation Center', autoCandidates, duplicateClusters, kbDrafts, healthRows });
    } catch (error) { return next(error); }
  });

  app.use('/:tenantSlug/admin/ops', requireTenantMatch, requireAuth, requireRole(['superadmin']), opsRoutes);


  app.get('/:tenantSlug/agent/unassigned', requireTenantMatch, requireAuth, requireRole(['agent_manager', 'support_head', 'superadmin']), async (req, res, next) => {
    try {
      const filter = { tenantId: req.tenant._id, assignedToUserId: null, status: { $nin: ['CLOSED'] } };
      if (req.currentUser.role !== 'superadmin') {
        const allowed = await getAccessibleEntityIdsForUser(req.currentUser);
        filter.entityId = { $in: Array.isArray(allowed) ? allowed : [] };
      }
      const issues = await Issue.find(filter)
        .populate('entityId', 'name path')
        .populate('createdByUserId', 'name email')
        .sort({ createdAt: -1 })
        .limit(100)
        .lean();
      return res.render('tickets/unassigned', { title: 'Unassigned Issues', issues });
    } catch (error) { return next(error); }
  });

  app.use('/:tenantSlug/agent/workspace', requireTenantMatch, requireAuth, requireRole(['agent', 'agent_user', 'agent_manager', 'support_head', 'superadmin']), agentWorkspaceRoutes);
  app.use('/:tenantSlug/client', requireTenantMatch, requireAuth, requireRole(['client','client_user']), clientPortalRoutes);
  app.use('/:tenantSlug/tickets', requireTenantMatch, requireAuth, issueRoutes);

  app.use(notFoundHandler);

  app.use((err, req, res, next) => {
    captureError(err, {
      path: req.originalUrl,
      tenantSlug: req.params?.tenantSlug || null
    });

    logError('unhandled_error', {
      path: req.originalUrl,
      message: err.message
    });

    next(err);
  });

  app.use(errorHandler);

  return app;
}

module.exports = { createApp };
