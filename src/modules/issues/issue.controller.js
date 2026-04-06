const crypto = require('crypto');
const mongoose = require('mongoose');
const { Issue, ISSUE_STATUSES, ISSUE_PRIORITIES, TRIAGE_STATUSES, EXECUTION_MODES, EXECUTION_STATES, CUSTOMER_VISIBILITIES } = require('./issue.model');
const { IssueComment, COMMENT_VISIBILITIES } = require('./issue-comment.model');
const { IssueActivity } = require('./issue-activity.model');
const { Entity } = require('../entities/entity.model');
const { resolveEffectiveEntityJiraConfig } = require('../entities/entity.service');
const { EntityJiraFieldMetadata } = require('../entities/entity-jira-metadata.model');
const { User } = require('../users/user.model');
const { logAudit } = require('../audit/audit.service');
const { AuditLog } = require('../audit/audit.model');
const {
  normalizeId,
  getAccessibleEntityIdsForUser,
  userHasEntityAccess,
  getAssignableAgentsForEntity,
  validateAssignableAgentForEntity
} = require('../../utils/access');
const { generateIssueNumber, listCreatableEntitiesForUser, createIssueActivity } = require('./issue.service');
const { resolveRouting } = require('../routing/routing.service');
const { uploadFile } = require('../storage/storage.service');
const { getUploadUiConfig, getPreviewKindForMimeOrName } = require('../../config/uploads');
const { getPagination, buildPager, buildQueryString } = require('../../utils/pagination');
const { rowsToExcelXml, sendExcelXml } = require('../../utils/export');
const { getTenantJiraConnection, serializeConnection } = require('../integrations/jira/jira-connection.service');
const { jiraRequest, isMockMode } = require('../integrations/jira/jira.service');
const { enqueueJiraPush } = require('../queue/queue.service');
const { appendJiraLinkEvent, getJiraLinkByIssueId } = require('../integrations/jira/jira-link.service');
const { notifyUsers } = require('../notifications/notification.service');
const { getCreateFieldMetadata, resolveIssueTypeForProject } = require('../integrations/jira/jira-metadata.service');
const { sanitizeMetadataFields, sanitizeJiraFieldValues, isValidJiraFieldKey } = require('../integrations/jira/jira-field-utils');
const { resolveSlaPolicy, resolveAgreementBundle, buildSlaSnapshot, buildCommitmentSnapshots, evaluateIssueSla, pauseIssueSla, resumeIssueSla, appendSlaEvent, syncCommitmentsFromPrimarySla } = require('../sla/sla.service');
const { SavedView } = require('../saved-views/saved-view.model');
const { WorkflowConfig } = require('../workflows/workflow.model');



async function notifyIssueStakeholders({ tenantId, issue, type, actorUserId = null, subject = '', body = '', extraUserIds = [] }) {
  try {
    const stakeholderIds = [issue.createdByUserId, issue.assignedToUserId, ...(extraUserIds || [])]
      .filter(Boolean)
      .map((item) => String(item._id || item));
    if (!stakeholderIds.length) return;
    await notifyUsers({ tenantId, issueId: issue._id, type, userIds: stakeholderIds, actorUserId, subject, body, metadata: { issueNumber: issue.issueNumber, issueId: String(issue._id) }, sendEmail: true });
  } catch (error) {
    console.error('Failed to create stakeholder notifications', error.message);
  }
}

function getIntakeConfig(connection = null) {
  const intake = connection?.intake || {};
  const hasExplicitConfig = Boolean(
    String(intake.projectKey || '').trim() ||
    String(intake.issueTypeName || '').trim() ||
    typeof intake.isActive === 'boolean' ||
    typeof intake.minimalMode === 'boolean'
  );
  const isActive = intake.isActive === true || (!('isActive' in intake) && hasExplicitConfig);
  return {
    minimalMode: isActive ? intake.minimalMode !== false : false,
    projectKey: String(intake.projectKey || '').trim().toUpperCase(),
    issueTypeName: String(intake.issueTypeName || 'Bug').trim() || 'Bug',
    defaultStatusAfterPush: String(intake.defaultStatusAfterPush || 'PUSHED_TO_JIRA').trim() || 'PUSHED_TO_JIRA',
    pushAttachments: intake.pushAttachments !== false,
    isActive
  };
}

function getJiraBrowseUrl(connection, issueKey) {
  const key = String(issueKey || '').trim();
  if (!key) return '';
  const baseUrl = String(connection?.baseUrl || '').trim().replace(/\/+$/, '');
  return baseUrl ? `${baseUrl}/browse/${key}` : '';
}

function mapJiraStatusToEsop(raw) {
  const value = String(raw || '').trim().toUpperCase();
  if (!value) return 'OPEN';
  if (value.includes('READY TO CLOSE') || value.includes('READY_TO_CLOSE')) return 'READY_TO_CLOSE';
  if (value.includes('CLOSE') || value.includes('CLOSED') || value.includes('DONE') || value.includes('COMPLETE') || value.includes('COMPLETED') || value.includes('FINISH')) return 'READY_TO_CLOSE';
  if (value.includes('RESOLV')) return 'RESOLVED';
  if (value.includes('WAIT') || value.includes('PENDING CUSTOMER') || value.includes('NEED INFO') || value.includes('MORE INFO') || value.includes('ON HOLD')) return 'WAITING_FOR_CLIENT';
  if (value.includes('PROGRESS') || value.includes('ACTIVE') || value.includes('ONGOING') || value.includes('IN DEVELOPMENT') || value.includes('IN REVIEW') || value.includes('IMPLEMENT') || value.includes('TEST')) return 'IN_PROGRESS';
  if (value.includes('OPEN') || value.includes('TODO') || value.includes('TO DO') || value.includes('BACKLOG') || value.includes('SELECTED FOR DEVELOPMENT') || value.includes('TRIAGE')) return 'OPEN';
  return 'OPEN';
}

function deriveEsopStatusFromJira({ jiraStatusName = '', jiraStatusCategory = '', fallbackStatus = 'OPEN' } = {}) {
  const normalizedCategory = String(jiraStatusCategory || '').trim().toLowerCase();
  if (['done', 'complete', 'completed'].includes(normalizedCategory)) return 'READY_TO_CLOSE';
  return mapJiraStatusToEsop(jiraStatusName || jiraStatusCategory || fallbackStatus);
}

function syncIssueStateFromJiraStatus(issue, jiraStatusName = '', jiraStatusCategory = '', source = 'MANUAL_REFRESH') {
  const mappedStatus = deriveEsopStatusFromJira({ jiraStatusName, jiraStatusCategory, fallbackStatus: issue.status });
  const beforeStatus = issue.status;
  issue.jira = issue.jira || {};
  issue.jira.currentStatusName = String(jiraStatusName || issue.jira.currentStatusName || '').trim();
  issue.jira.currentStatusCategory = String(jiraStatusCategory || issue.jira.currentStatusCategory || '').trim();
  issue.jira.statusLastSyncedAt = new Date();
  issue.jira.lastSyncSource = source;
  issue.executionMode = issue.executionMode || 'JIRA';
  issue.executionState = issue.jira.issueKey ? 'SYNCED' : issue.executionState;
  issue.status = mappedStatus;
  issue.closure = issue.closure || {};
  if (mappedStatus === 'READY_TO_CLOSE') {
    issue.closure.awaitingAgentClosure = true;
    issue.closure.jiraResolvedAt = new Date();
  } else if (mappedStatus !== 'CLOSED') {
    issue.closure.awaitingAgentClosure = false;
  }
  if (issue.sla) {
    if (['READY_TO_CLOSE', 'CLOSED'].includes(mappedStatus) && !issue.sla.resolvedAt) issue.sla.resolvedAt = new Date();
    if (!['READY_TO_CLOSE', 'CLOSED'].includes(mappedStatus)) issue.sla.resolvedAt = null;
    evaluateIssueSla(issue);
  }
  return { mappedStatus, beforeStatus };
}




function parseDateOnly(value, options = {}) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const [, year, month, day] = match;
  const date = options.endOfDay
    ? new Date(`${year}-${month}-${day}T23:59:59.999Z`)
    : new Date(`${year}-${month}-${day}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatDateForExport(value) {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return '';
  return date.toISOString().slice(0, 10);
}

function csvEscape(value) {
  const stringValue = value == null ? '' : String(value);
  if (/[,"\n]/.test(stringValue)) {
    return `"${stringValue.replace(/"/g, '""')}"`;
  }
  return stringValue;
}

function sendCsv(res, filename, headers, rows) {
  const lines = [headers.map(csvEscape).join(',')].concat(rows.map((row) => row.map(csvEscape).join(',')));
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  return res.send(lines.join('\n'));
}

function buildIssueExportRows(issues) {
  return (issues || []).map((issue) => {
    const entityName = issue.entityId?.path || issue.entityId?.name || issue.entitySnapshot?.path || issue.entitySnapshot?.name || '';
    const assignedTo = issue.assignedToUserId?.name || issue.assigneeSnapshot?.name || '';
    const createdBy = issue.createdByUserId?.name || issue.createdByUserId?.email || issue.createdBySnapshot?.name || '';
    const resolvedOn = issue.sla?.resolvedAt || issue.closure?.jiraResolvedAt || issue.closure?.closedAt || null;
    return [
      issue.issueNumber || '',
      issue.title || '',
      entityName,
      issue.product || '',
      issue.status || '',
      issue.jira?.issueKey || '',
      issue.jira?.currentStatusName || '',
      issue.priority || '',
      issue.triageStatus || '',
      assignedTo,
      createdBy,
      formatDateForExport(issue.createdAt),
      formatDateForExport(resolvedOn)
    ];
  });
}
function normalizeIssuesSort(sortBy, sortDir) {
  const direction = String(sortDir || '').toLowerCase() == 'asc' ? 1 : -1;
  const normalized = String(sortBy || 'createdAt').trim();
  const sortMap = {
    issueNumber: { issueNumber: direction, createdAt: -1 },
    title: { title: direction, createdAt: -1 },
    entity: { 'entitySnapshot.path': direction, 'entitySnapshot.name': direction, createdAt: -1 },
    createdAt: { createdAt: direction, _id: direction },
    resolvedAt: { 'sla.resolvedAt': direction, 'closure.closedAt': direction, createdAt: -1 },
    status: { status: direction, createdAt: -1 },
    jiraStatus: { 'jira.currentStatusName': direction, 'jira.issueKey': direction, createdAt: -1 },
    priority: { priorityRank: direction, createdAt: -1 },
    triageStatus: { triageStatus: direction, createdAt: -1 },
    assignedTo: { 'assigneeSnapshot.name': direction, createdAt: -1 }
  };
  const safeSortBy = Object.prototype.hasOwnProperty.call(sortMap, normalized) ? normalized : 'createdAt';
  return {
    sortBy: safeSortBy,
    sortDir: direction === 1 ? 'asc' : 'desc',
    sortSpec: sortMap[safeSortBy]
  };
}

function badRequest(message) {
  const err = new Error(message);
  err.status = 400;
  return err;
}

function forbidden(message) {
  const err = new Error(message);
  err.status = 403;
  return err;
}

function escapeRegex(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function getReporterTypeForUser(user) {
  if (user.role === 'client') return 'client_user';
  if (user.role === 'agent') return 'agent';
  if (user.role === 'superadmin') return 'superadmin';
  return 'system';
}

function canChangeIssueStatus(user) {
  return ['client', 'agent', 'superadmin'].includes(user.role);
}

function canAssignIssue(user) {
  return ['agent', 'superadmin'].includes(user.role);
}

function canTriageIssue(user) {
  return ['agent', 'superadmin'].includes(user.role);
}

function canChangeExecutionMode(user) {
  return ['agent', 'superadmin'].includes(user.role);
}

function isApiRequest(req) {
  return req.originalUrl.startsWith('/api/');
}

function parseJiraFieldInputs(body = {}) {
  const fields = {};
  for (const [key, value] of Object.entries(body || {})) {
    if (!key.startsWith('jiraField__')) continue;
    const fieldId = key.replace('jiraField__', '');
    if (!fieldId) continue;
    fields[fieldId] = value;
  }
  return fields;
}

function shouldMarkFirstResponse(user, visibility) {
  return ['agent', 'superadmin'].includes(user.role) && String(visibility || 'EXTERNAL').toUpperCase() === 'EXTERNAL';
}

async function syncSlaForIssue(issue, { changedStatus = false, commentActor = null, commentVisibility = null } = {}) {
  if (!issue.sla) return issue;
  if (commentActor && !issue.sla.firstRespondedAt && shouldMarkFirstResponse(commentActor, commentVisibility)) {
    issue.sla.firstRespondedAt = new Date();
    issue.sla.respondedByUserId = commentActor._id;
  }
  if (changedStatus) {
    if (['RESOLVED', 'CLOSED'].includes(issue.status) && !issue.sla.resolvedAt) {
      issue.sla.resolvedAt = new Date();
    }
    if (!['RESOLVED', 'CLOSED'].includes(issue.status)) {
      issue.sla.resolvedAt = null;
    }
  }
  evaluateIssueSla(issue);
  return issue;
}

const AUTO_MAPPED_JIRA_FIELDS = new Set(['summary', 'description', 'priority', 'labels', 'project', 'issuetype']);

function keepOnlyCustomerEnteredJiraFields(jiraFieldValues = {}, metadataFields = []) {
  const safeMetadataFields = sanitizeMetadataFields(metadataFields);
  const requiredIds = new Set(safeMetadataFields.filter((field) => field.required).map((field) => String(field.fieldId || '')));
  const filtered = {};
  for (const [fieldId, value] of Object.entries(sanitizeJiraFieldValues(jiraFieldValues, safeMetadataFields))) {
    if (!requiredIds.has(String(fieldId))) continue;
    if (AUTO_MAPPED_JIRA_FIELDS.has(String(fieldId))) continue;
    filtered[fieldId] = value;
  }
  return filtered;
}

function normalizeMetadataFieldValue(field, value) {
  if (value === null || typeof value === 'undefined') return value;
  if (field.uiType === 'multiselect' || field.uiType === 'labels') {
    if (Array.isArray(value)) return value.filter(Boolean);
    return String(value).split(',').map((item) => item.trim()).filter(Boolean);
  }
  if (Array.isArray(value)) return value.filter(Boolean);
  return typeof value === 'string' ? value.trim() : value;
}

function validateRequiredJiraFields(metadataFields = [], jiraFieldValues = {}) {
  const safeMetadataFields = sanitizeMetadataFields(metadataFields);
  const safeValues = sanitizeJiraFieldValues(jiraFieldValues, safeMetadataFields);
  const missing = [];
  for (const field of safeMetadataFields.filter((item) => item.required)) {
    if (['summary', 'description'].includes(field.fieldId)) continue;
    const value = normalizeMetadataFieldValue(field, safeValues[field.fieldId]);
    const isMissing = Array.isArray(value) ? value.length === 0 : value === '' || value === null || typeof value === 'undefined';
    if (isMissing) missing.push(field.name || field.fieldId);
  }
  return missing;
}

async function getJiraMetadataForIssueContext({ tenantId, entityId, resolvedConfig, connection }) {
  if (!resolvedConfig) return { fields: [], source: 'NONE' };
  let cached = await EntityJiraFieldMetadata.findOne({ tenantId, entityId, projectKey: resolvedConfig.projectKey, issueTypeId: resolvedConfig.issueTypeId }).lean();
  if (cached) return { fields: sanitizeMetadataFields(cached.fields || []), source: cached.source || 'CACHE' };
  if (!connection || !connection.isActive) return { fields: [], source: 'NONE' };
  const live = await getCreateFieldMetadata(connection, resolvedConfig.projectKey, resolvedConfig.issueTypeId, resolvedConfig.issueTypeName);
  await EntityJiraFieldMetadata.findOneAndUpdate(
    { tenantId, entityId, projectKey: live.projectKey, issueTypeId: live.issueTypeId },
    { $set: { issueTypeName: live.issueTypeName, fields: live.fields, source: live.source, lastSyncedAt: new Date() } },
    { upsert: true }
  );
  return { fields: sanitizeMetadataFields(live.fields || []), source: live.source || 'LIVE' };
}

function normalizeAttachment(attachment = {}, tenantSlug = "") {
  const id = attachment._id ? String(attachment._id) : null;
  const filename = attachment.filename || attachment.fileName || null;
  const mimeType = attachment.mimeType || attachment.fileType || 'application/octet-stream';
  const originalName = attachment.originalName || filename || 'attachment';
  const createdAt = attachment.createdAt || attachment.uploadedAt || null;
  const previewKind = getPreviewKindForMimeOrName({ mimeType, filename, originalName });
  return {
    id,
    _id: id,
    filename,
    fileName: filename,
    originalName,
    mimeType,
    fileType: mimeType,
    size: attachment.size || 0,
    tenantId: normalizeId(attachment.tenantId),
    issueId: normalizeId(attachment.issueId),
    uploadedByUserId: normalizeId(attachment.uploadedByUserId),
    createdAt,
    uploadedAt: createdAt,
    previewKind,
    isPreviewable: !!previewKind,
    previewUrl: id ? `/api/v1/${tenantSlug}/files/${id}/preview` : null,
    thumbnailUrl: previewKind === 'image' && id ? `/api/v1/${tenantSlug}/files/${id}/preview` : null,
    downloadUrl: id ? `/api/v1/${tenantSlug}/files/${id}/download` : attachment.url || null,
    url: id ? `/api/v1/${tenantSlug}/files/${id}/download` : attachment.url || null
  };
}

async function uploadFilesAndBuildAttachments({ files = [], tenantId, issueId, uploadedBy, commentId = null, entityId = null }) {
  const attachments = [];
  for (const file of files) {
    const asset = await uploadFile({ file, tenantId, issueId, uploadedBy, commentId, entityId });
    attachments.push({
      _id: asset._id,
      filename: asset.filename,
      fileName: asset.filename,
      originalName: asset.originalName,
      mimeType: asset.mimeType,
      fileType: asset.mimeType,
      size: asset.size,
      tenantId: asset.tenantId,
      issueId: asset.issueId,
      uploadedByUserId: asset.uploadedByUserId,
      createdAt: asset.createdAt,
      uploadedAt: asset.createdAt,
      storageProvider: asset.storageProvider,
      storagePath: asset.storagePath,
      url: `/api/v1/files/${asset._id}/download`
    });
  }
  return attachments;
}

function issueToJson(issue) {
  issue.tenantSlug = issue.tenantSlug || '';
  const effectiveStatus = issue.executionMode === 'JIRA' && issue.jira?.issueKey
    ? deriveEsopStatusFromJira({ jiraStatusName: issue.jira?.currentStatusName || '', jiraStatusCategory: issue.jira?.currentStatusCategory || '', fallbackStatus: issue.status || 'OPEN' })
    : issue.status;
  return {
    id: issue._id.toString(),
    issueNumber: issue.issueNumber,
    entityId: normalizeId(issue.entityId),
    entityName: issue.entityId?.name || null,
    entityPath: issue.entityId?.path || null,
    title: issue.title,
    description: issue.description,
    status: effectiveStatus,
    priority: issue.priority,
    category: issue.category,
    product: issue.product || issue.entityId?.metadata?.product || '',
    createdByUserId: normalizeId(issue.createdByUserId),
    createdByName: issue.createdByUserId?.name || null,
    assignedToUserId: normalizeId(issue.assignedToUserId),
    assignedToName: issue.assignedToUserId?.name || null,
    supportGroupId: normalizeId(issue.supportGroupId),
    supportGroup: issue.supportGroupId ? { id: normalizeId(issue.supportGroupId), name: issue.supportGroupId?.name || null, code: issue.supportGroupId?.code || null } : null,
    routingRuleId: normalizeId(issue.routingRuleId),
    routingStatus: issue.routingStatus || 'NOT_ROUTED',
    reporterType: issue.reporterType,
    triageStatus: issue.triageStatus || 'NOT_TRIAGED',
    triageNotes: issue.triageNotes || '',
    triagedByUserId: normalizeId(issue.triagedByUserId),
    triagedByName: issue.triagedByUserId?.name || null,
    triagedAt: issue.triagedAt || null,
    executionMode: issue.executionMode || 'NATIVE',
    executionState: issue.executionState || 'NOT_STARTED',
    jiraDraft: {
      projectKey: issue.jiraDraft?.projectKey || '',
      issueTypeId: issue.jiraDraft?.issueTypeId || '',
      issueTypeName: issue.jiraDraft?.issueTypeName || '',
      metadataSource: issue.jiraDraft?.metadataSource || 'NONE',
      fields: issue.jiraDraft?.fields || {},
      appliedMappings: issue.jiraDraft?.appliedMappings || []
    },
    jiraId: issue.jira?.issueId || '',
    jiraKey: issue.jira?.issueKey || '',
    jiraUrl: issue.jira?.issueUrl || '',
    jiraIssueId: issue.jira?.issueId || '',
    jiraIssueKey: issue.jira?.issueKey || '',
    jira: {
      issueKey: issue.jira?.issueKey || '',
      issueId: issue.jira?.issueId || '',
      issueUrl: issue.jira?.issueUrl || '',
      projectKey: issue.jira?.projectKey || '',
      currentStatusName: issue.jira?.currentStatusName || '',
      currentStatusCategory: issue.jira?.currentStatusCategory || '',
      statusLastSyncedAt: issue.jira?.statusLastSyncedAt || null,
      pushedAt: issue.jira?.pushedAt || null,
      pushedByUserId: normalizeId(issue.jira?.pushedByUserId),
      pushStatus: issue.jira?.pushStatus || 'NOT_PUSHED',
      pushErrorMessage: issue.jira?.pushErrorMessage || ''
    },
    sla: {
      hasPolicy: !!issue.sla?.hasPolicy,
      policyId: normalizeId(issue.sla?.policyId),
      policyName: issue.sla?.policyName || '',
      responseTargetMinutes: issue.sla?.responseTargetMinutes ?? null,
      resolutionTargetMinutes: issue.sla?.resolutionTargetMinutes ?? null,
      warningThresholdPercent: issue.sla?.warningThresholdPercent ?? 80,
      responseDueAt: issue.sla?.responseDueAt || null,
      resolutionDueAt: issue.sla?.resolutionDueAt || null,
      firstRespondedAt: issue.sla?.firstRespondedAt || null,
      respondedByUserId: normalizeId(issue.sla?.respondedByUserId),
      resolvedAt: issue.sla?.resolvedAt || null,
      responseStatus: issue.sla?.responseStatus || 'NO_SLA',
      resolutionStatus: issue.sla?.resolutionStatus || 'NO_SLA',
      breachedAt: issue.sla?.breachedAt || { response: null, resolution: null },
      pausedAt: issue.sla?.pausedAt || null,
      totalPausedMinutes: issue.sla?.totalPausedMinutes ?? 0,
      stageTargets: issue.sla?.stageTargets || [],
      stageStatus: issue.sla?.stageStatus || [],
      escalationRecipients: issue.sla?.escalationRecipients || [],
      businessHoursMode: issue.sla?.businessHoursMode || 'TWENTY_FOUR_SEVEN',
      holidayCalendar: issue.sla?.holidayCalendar || [],
      lastEvaluatedAt: issue.sla?.lastEvaluatedAt || null
    },
    attachments: (issue.attachments || []).map((attachment) => normalizeAttachment(attachment, issue.tenantSlug || '')), 
    tags: issue.tags || [],
    source: issue.source,
    customerVisibility: issue.customerVisibility || 'VISIBLE_TO_CUSTOMER',
    customerStatusLabel: getHumanCustomerStatus(issue),
    isInternalOnly: (issue.customerVisibility || 'VISIBLE_TO_CUSTOMER') === 'INTERNAL_ONLY',
    createdAt: issue.createdAt,
    updatedAt: issue.updatedAt,
    lastUpdatedByUserId: normalizeId(issue.lastUpdatedByUserId)
  };
}

function commentToJson(comment) {
  comment.tenantSlug = comment.tenantSlug || '';
  return {
    id: comment._id.toString(),
    issueId: normalizeId(comment.issueId),
    entityId: normalizeId(comment.entityId),
    commentText: comment.commentText,
    authorUserId: normalizeId(comment.authorUserId),
    authorName: comment.authorUserId?.name || null,
    authorRole: comment.authorRole,
    visibility: comment.visibility,
    attachments: (comment.attachments || []).map((attachment) => normalizeAttachment(attachment, comment.tenantSlug || '')), 
    createdAt: comment.createdAt,
    updatedAt: comment.updatedAt
  };
}

function activityToJson(activity) {
  return {
    id: activity._id.toString(),
    issueId: normalizeId(activity.issueId),
    entityId: normalizeId(activity.entityId),
    type: activity.type,
    metadata: activity.metadata || {},
    performedByUserId: normalizeId(activity.performedByUserId),
    performedByName: activity.performedByUserId?.name || null,
    performedByRole: activity.performedByRole,
    createdAt: activity.createdAt
  };
}

function normalizeTimelineValue(value, emptyValue = 'Unassigned') {
  if (value === null || typeof value === 'undefined' || value === '') return emptyValue;
  if (typeof value === 'string') return value;
  if (typeof value === 'object') {
    if (value.name) return value.name;
    if (value.email) return value.email;
    if (value.status) return value.status;
    if (value.assignedToName) return value.assignedToName;
    if (value.assignedToEmail) return value.assignedToEmail;
    if (value.assignedToUserId) return value.assignedToUserId;
  }
  return String(value);
}

function historyActivityMessage(activity) {
  const metadata = activity.metadata || {};
  if (activity.type === 'ISSUE_CREATED') return 'Issue created';
  if (activity.type === 'ISSUE_REOPENED') {
    const before = normalizeTimelineValue(metadata.before, 'Unknown');
    const after = normalizeTimelineValue(metadata.after, 'OPEN');
    return `Issue reopened (${before} → ${after})`;
  }
  if (activity.type === 'STATUS_CHANGED') {
    const before = normalizeTimelineValue(metadata.before, 'Unknown');
    const after = normalizeTimelineValue(metadata.after, 'Unknown');
    return `Status changed from ${before} → ${after}`;
  }
  if (activity.type === 'ASSIGNED') {
    const before = normalizeTimelineValue(metadata.before, 'Unassigned');
    const after = normalizeTimelineValue(metadata.after, 'Unassigned');
    return `Assigned from ${before} → ${after}`;
  }
  if (activity.type === 'TRIAGE_STARTED') return 'Triage started';
  if (activity.type === 'TRIAGE_COMPLETED') return 'Triage completed';
  if (activity.type === 'ISSUE_ATTACHMENTS_ADDED') return `${metadata.count || 0} issue attachment(s) added`;
  if (activity.type === 'COMMENT_ATTACHMENTS_ADDED') return `${metadata.count || 0} comment attachment(s) added`;
  if (activity.type === 'ISSUE_EXECUTION_MODE_SET') {
    const before = normalizeTimelineValue(metadata.before?.executionMode || metadata.before, 'NATIVE');
    const after = normalizeTimelineValue(metadata.after?.executionMode || metadata.after, 'NATIVE');
    return `Execution mode changed from ${before} → ${after}`;
  }
  if (activity.type === 'ISSUE_SENT_TO_JIRA') return `Issue sent to Jira${metadata.jiraIssueKey ? ` (${metadata.jiraIssueKey})` : ''}`;
  if (activity.type === 'WEBHOOK_SYNC') return `Jira sync updated status${metadata.after ? ` → ${metadata.after}` : ''}`;
  if (activity.type === 'AGENT_CLOSURE_REQUIRED') return 'Jira marked the issue resolved; agent closure is now required';
  if (activity.type === 'JIRA_PUSH_CONFIRMED_EXISTING') return `Existing Jira issue linked${metadata.jiraIssueKey ? ` (${metadata.jiraIssueKey})` : ''}`;
  if (activity.type === 'JIRA_WEBHOOK_REJECTED') return 'Rejected invalid Jira webhook';
  if (activity.type === 'SLA_POLICY_APPLIED') return `SLA policy applied (${metadata.policyName || 'Unnamed policy'})`;
  if (activity.type === 'SLA_FIRST_RESPONSE_MET') return 'First response captured for SLA';
  if (activity.type === 'SLA_RESOLUTION_MET') return 'Resolution captured for SLA';
  if (activity.type === 'JIRA_CONNECTION_SAVED') return 'Jira connection saved';
  if (activity.type === 'JIRA_CONNECTION_VALIDATED') return 'Jira connection validated';
  if (activity.type === 'COMMENT_ADDED') {
    const visibility = metadata.visibility === 'INTERNAL' ? 'internal' : 'external';
    return `Comment added (${visibility})`;
  }
  return activity.type;
}

function historyActivityToJson(activity) {
  const item = activityToJson(activity);
  return {
    kind: 'activity',
    ...item,
    message: historyActivityMessage(item)
  };
}

function getCommentVisibilityFilter(user) {
  if (user.role === 'client') return { visibility: 'EXTERNAL' };
  return {};
}

function getCommentFormOptions(user) {
  return {
    canComment: ['client', 'agent', 'superadmin'].includes(user.role),
    canChooseVisibility: ['agent', 'superadmin'].includes(user.role),
    defaultVisibility: 'EXTERNAL'
  };
}


function canUserViewIssue(user, issue) {
  if (!user || !issue) return false;
  if (['agent', 'superadmin'].includes(user.role)) return true;
  return (issue.customerVisibility || 'VISIBLE_TO_CUSTOMER') === 'VISIBLE_TO_CUSTOMER';
}

function applyCustomerVisibilityFilter(filter, user) {
  if (user && user.role === 'client') {
    filter.customerVisibility = 'VISIBLE_TO_CUSTOMER';
  }
  return filter;
}

function getHumanCustomerStatus(issue) {
  const mapping = {
    NEW: 'Submitted',
    OPEN: 'Submitted',
    IN_PROGRESS: 'We are working on it',
    WAITING_FOR_CLIENT: 'Waiting for your input',
    RESOLVED: 'Resolved',
    READY_TO_CLOSE: 'Closed for Review',
    CLOSED: 'Closed'
  };
  return mapping[issue.status] || issue.status;
}

function getAllowedStatusTransitions(user, currentStatus) {
  const roleTransitions = {
    client: {
      NEW: ['OPEN'],
      WAITING_FOR_CLIENT: ['OPEN'],
      RESOLVED: ['OPEN'],
      READY_TO_CLOSE: ['OPEN'],
      CLOSED: ['OPEN']
    },
    agent: {
      NEW: ['OPEN', 'IN_PROGRESS'],
      OPEN: ['IN_PROGRESS', 'WAITING_FOR_CLIENT', 'RESOLVED', 'READY_TO_CLOSE', 'CLOSED'],
      IN_PROGRESS: ['WAITING_FOR_CLIENT', 'RESOLVED', 'OPEN', 'READY_TO_CLOSE', 'CLOSED'],
      WAITING_FOR_CLIENT: ['IN_PROGRESS', 'RESOLVED', 'OPEN', 'READY_TO_CLOSE', 'CLOSED'],
      RESOLVED: ['READY_TO_CLOSE', 'CLOSED', 'OPEN'],
      READY_TO_CLOSE: ['CLOSED', 'OPEN'],
      CLOSED: ['OPEN']
    },
    superadmin: {
      NEW: ['OPEN', 'IN_PROGRESS', 'WAITING_FOR_CLIENT', 'RESOLVED', 'READY_TO_CLOSE', 'CLOSED'],
      OPEN: ['NEW', 'IN_PROGRESS', 'WAITING_FOR_CLIENT', 'RESOLVED', 'READY_TO_CLOSE', 'CLOSED'],
      IN_PROGRESS: ['NEW', 'OPEN', 'WAITING_FOR_CLIENT', 'RESOLVED', 'READY_TO_CLOSE', 'CLOSED'],
      WAITING_FOR_CLIENT: ['NEW', 'OPEN', 'IN_PROGRESS', 'RESOLVED', 'READY_TO_CLOSE', 'CLOSED'],
      RESOLVED: ['NEW', 'OPEN', 'READY_TO_CLOSE', 'CLOSED'],
      READY_TO_CLOSE: ['NEW', 'OPEN', 'CLOSED'],
      CLOSED: ['NEW', 'OPEN']
    }
  };

  const map = roleTransitions[user.role] || {};
  return map[currentStatus] || [];
}


async function buildIssueFilter(req) {
  const filter = applyCustomerVisibilityFilter({ tenantId: req.tenant._id }, req.currentUser);
  const user = req.currentUser;

  if (user.role !== 'superadmin') {
    const allowedEntityIds = await getAccessibleEntityIdsForUser(user);
    filter.entityId = { $in: allowedEntityIds };
  }

  const requestedView = req.query.savedViewId ? await SavedView.findOne({ _id: req.query.savedViewId, tenantId: req.tenant._id, userId: req.currentUser._id }).lean() : null;
  const incoming = requestedView?.filters ? { ...requestedView.filters, ...req.query } : req.query;
  if (incoming.entityId) filter.entityId = incoming.entityId;
  if (incoming.status) filter.status = incoming.status;
  if (incoming.priority) filter.priority = incoming.priority;
  if (incoming.assignedToUserId) filter.assignedToUserId = incoming.assignedToUserId;
  if (incoming.createdByUserId) filter.createdByUserId = incoming.createdByUserId;
  if (incoming.triageStatus && TRIAGE_STATUSES.includes(incoming.triageStatus)) filter.triageStatus = incoming.triageStatus;
  if (incoming.executionMode) filter.executionMode = incoming.executionMode;
  if (incoming.routingStatus) filter.routingStatus = incoming.routingStatus;
  if (incoming.supportGroupId) filter.supportGroupId = incoming.supportGroupId;
  if (incoming.slaStatus) filter.$or = [{ 'sla.responseStatus': incoming.slaStatus }, { 'sla.resolutionStatus': incoming.slaStatus }];
  if (incoming.customerVisibility && CUSTOMER_VISIBILITIES.includes(incoming.customerVisibility) && user.role !== 'client') filter.customerVisibility = incoming.customerVisibility;

  const q = String(incoming.q || '').trim();
  if (q) {
    const startsWithRegex = new RegExp(`^${escapeRegex(q)}`, 'i');
    const containsRegex = new RegExp(escapeRegex(q), 'i');
    filter.$or = [
      { issueNumber: startsWithRegex },
      { title: containsRegex },
      { description: containsRegex },
      { tags: containsRegex }
    ];
  }

  return filter;
}



async function listIssuesPage(req, res, next) {
  try {
    const defaultView = await SavedView.findOne({ tenantId: req.tenant._id, userId: req.currentUser._id, isDefault: true }).lean();
    const baseQuery = defaultView?.filters ? { ...defaultView.filters, ...req.query } : req.query;
    const sort = normalizeIssuesSort(baseQuery.sortBy, baseQuery.sortDir);
    const filters = {
      q: baseQuery.q || '',
      entityId: baseQuery.entityId || '',
      status: baseQuery.status || '',
      priority: baseQuery.priority || '',
      triageStatus: baseQuery.triageStatus || '',
      assignedToUserId: baseQuery.assignedToUserId || '',
      createdByUserId: baseQuery.createdByUserId || '',
      executionMode: baseQuery.executionMode || '',
      routingStatus: baseQuery.routingStatus || '',
      slaStatus: baseQuery.slaStatus || '',
      customerVisibility: baseQuery.customerVisibility || '',
      product: baseQuery.product || '',
      createdFrom: baseQuery.createdFrom || '',
      createdTo: baseQuery.createdTo || '',
      pageSize: 15,
      sortBy: sort.sortBy,
      sortDir: sort.sortDir
    };

    const filter = applyCustomerVisibilityFilter({ tenantId: req.tenant._id }, req.currentUser);
    if (req.currentUser.role === 'client' || req.currentUser.role === 'agent') {
      const scopeIds = await getAccessibleEntityIdsForUser(req.currentUser);
      filter.entityId = { $in: scopeIds.length ? scopeIds : [] };
    }

    if (filters.q) {
      filter.$or = [
        { issueNumber: new RegExp(`^${escapeRegex(filters.q)}`, 'i') },
        { title: new RegExp(escapeRegex(filters.q), 'i') },
        { description: new RegExp(escapeRegex(filters.q), 'i') },
        { tags: new RegExp(escapeRegex(filters.q), 'i') }
      ];
    }
    if (filters.entityId) filter.entityId = filters.entityId;
    if (filters.status) filter.status = filters.status;
    if (filters.priority) filter.priority = filters.priority;
    if (filters.triageStatus) filter.triageStatus = filters.triageStatus;
    if (filters.assignedToUserId) filter.assignedToUserId = filters.assignedToUserId;
    if (filters.createdByUserId) filter.createdByUserId = filters.createdByUserId;
    if (filters.executionMode) filter.executionMode = filters.executionMode;
    if (filters.routingStatus) filter.routingStatus = filters.routingStatus;
    if (filters.slaStatus) filter.$and = [{ $or: [{ 'sla.responseStatus': filters.slaStatus }, { 'sla.resolutionStatus': filters.slaStatus }] }];
    if (filters.customerVisibility && req.currentUser.role !== 'client') filter.customerVisibility = filters.customerVisibility;
    if (filters.product) filter.product = filters.product;

    const createdFrom = parseDateOnly(filters.createdFrom);
    const createdTo = parseDateOnly(filters.createdTo, { endOfDay: true });
    if (createdFrom || createdTo) {
      filter.createdAt = {};
      if (createdFrom) filter.createdAt.$gte = createdFrom;
      if (createdTo) filter.createdAt.$lte = createdTo;
    }

    const [entities, users, savedViews, productOptions] = await Promise.all([
      Entity.find({ tenantId: req.tenant._id, isActive: true }).sort({ path: 1 }),
      User.find({ tenantId: req.tenant._id, isActive: true }).sort({ name: 1 }),
      SavedView.find({ tenantId: req.tenant._id, userId: req.currentUser._id }).sort({ isDefault: -1, name: 1 }).lean(),
      Issue.distinct('product', { tenantId: req.tenant._id, product: { $exists: true, $ne: '' } })
    ]);

    const { page, pageSize, skip } = getPagination({ ...req.query, pageSize: 15 }, 15);
    const totalItems = await Issue.countDocuments(filter);
    const issues = await Issue.find(filter)
      .populate('entityId assignedToUserId createdByUserId')
      .sort(sort.sortSpec)
      .skip(skip)
      .limit(pageSize);

    issues.forEach((item) => {
      evaluateIssueSla(item);
      item.tenantSlug = req.tenant.slug;
    });
    const pager = buildPager({ totalItems, page, pageSize });
    return res.render('tickets/list', {
      title: 'Issues',
      issues,
      entities,
      users,
      filters,
      statuses: ISSUE_STATUSES,
      priorities: ISSUE_PRIORITIES,
      triageStatuses: TRIAGE_STATUSES,
      pager,
      buildQueryString,
      savedViews,
      productOptions: (productOptions || []).filter(Boolean).sort((a, b) => String(a).localeCompare(String(b))),
      sort
    });
  } catch (error) {
    return next(error);
  }
}



async function showCreateIssue(req, res, next) {
  try {
    const entities = await listCreatableEntitiesForUser(req.currentUser);
    const requestedEntityId = req.query.entityId || '';
    const selectedEntityId = requestedEntityId && entities.some((entity) => String(entity._id) === String(requestedEntityId))
      ? requestedEntityId
      : entities.length === 1
        ? String(entities[0]._id)
        : '';

    return res.render('tickets/new', {
      title: 'Create Issue',
      entities,
      priorities: ISSUE_PRIORITIES,
      defaults: { priority: 'MEDIUM', source: 'portal', entityId: selectedEntityId, category: 'General', customerVisibility: req.currentUser.role === 'client' ? 'VISIBLE_TO_CUSTOMER' : 'VISIBLE_TO_CUSTOMER' },
      uploadLimits: getUploadUiConfig(),
      customerVisibilities: CUSTOMER_VISIBILITIES,
      createAction: req.originalUrl.includes('/client/') ? `${req.basePath}/client/issues` : `${req.basePath}/tickets`,
      portalMode: req.originalUrl.includes('/client/') ? 'client' : 'staff'
      // Do not pass auditTrail here unless it is explicitly loaded in this scope.
      // The create-issue page has no audit timeline and an undefined reference will crash the flow.
    });
  } catch (error) {
    return next(error);
  }
}

async function createIssue(req, res, next) {
  try {
    const { entityId, title, description, priority = 'MEDIUM', category = 'General', tags = '', source = 'portal', customerVisibility: requestedCustomerVisibility = 'VISIBLE_TO_CUSTOMER' } = req.body;

    if (!title || !String(title).trim()) throw badRequest('Title is required.');
    if (!description || !String(description).trim()) throw badRequest('Description is required.');
    if (!category || !String(category).trim()) throw badRequest('Category is required.');
    if (!mongoose.Types.ObjectId.isValid(entityId)) throw badRequest('Valid entityId is required.');
    if (!ISSUE_PRIORITIES.includes(String(priority).toUpperCase())) throw badRequest('Priority is invalid.');

    const entity = await Entity.findOne({ _id: entityId, tenantId: req.tenant._id, isActive: true }).lean();
    if (!entity) throw badRequest('Selected entity was not found.');
    if (!(await userHasEntityAccess(req.currentUser, entityId))) throw forbidden('You do not have access to this entity.');

    const routing = await resolveRouting({
      tenantId: req.tenant._id,
      entityId,
      category: String(category).trim(),
      priority: String(priority).toUpperCase()
    });
    const routingDecision = {
      matched: Boolean(routing.routingRuleId),
      reason: routing.routingRuleId ? 'Matched routing rule' : 'No routing rule matched; defaults applied',
      evaluatedAt: new Date(),
      trace: [{ step: 'category', value: String(category).trim() }, { step: 'priority', value: String(priority).toUpperCase() }, { step: 'entityId', value: String(entityId) }, { step: 'supportGroupId', value: routing.supportGroupId ? String(routing.supportGroupId) : '' }, { step: 'executionMode', value: routing.executionMode || 'NATIVE' }, { step: 'jiraProjectKey', value: routing.jiraProjectKey || '' }]
    };

    const resolvedJira = await resolveEffectiveEntityJiraConfig({ tenantId: req.tenant._id, entityId });
    const connection = resolvedJira.config ? await getTenantJiraConnection({ tenantId: req.tenant._id, includeSecret: true }) : null;
    const metadataResult = resolvedJira.config ? await getJiraMetadataForIssueContext({ tenantId: req.tenant._id, entityId, resolvedConfig: resolvedJira.config, connection }) : { fields: [], source: 'NONE' };    const jiraFieldValues = parseJiraFieldInputs(req.body);
    const finalJiraFieldValues = keepOnlyCustomerEnteredJiraFields(jiraFieldValues, metadataResult.fields || []);
    const agreementBundle = await resolveAgreementBundle({
      tenantId: req.tenant._id,
      entityId,
      category: String(category).trim(),
      priority: String(priority).toUpperCase(),
      executionMode: routing.executionMode || 'NATIVE',
      supportGroupId: routing.supportGroupId || null
    });
    const resolvedSlaPolicy = agreementBundle.bundle?.SLA || null;
    const slaSnapshot = buildSlaSnapshot({ policy: resolvedSlaPolicy, startedAt: new Date(), severity: String(priority).toUpperCase() });
    const commitmentSnapshots = buildCommitmentSnapshots(agreementBundle.bundle, new Date(), String(priority).toUpperCase());

    const customerVisibility = req.currentUser.role === 'client' ? 'VISIBLE_TO_CUSTOMER' : (CUSTOMER_VISIBILITIES.includes(String(requestedCustomerVisibility || '').toUpperCase()) ? String(requestedCustomerVisibility).toUpperCase() : 'VISIBLE_TO_CUSTOMER');

    const issue = await Issue.create({
      tenantId: req.tenant._id,
      entityId,
      issueNumber: await generateIssueNumber({ tenantId: req.tenant._id, entity }),
      title: String(title).trim(),
      description: String(description).trim(),
      status: 'NEW',
      priority: String(priority).toUpperCase(),
      category: String(category).trim(),
      product: entity.metadata?.product || '',
      createdByUserId: req.currentUser._id,
      lastUpdatedByUserId: req.currentUser._id,
      assignedToUserId: routing.assignedToUserId || null,
      supportGroupId: routing.supportGroupId || null,
      routingRuleId: routing.routingRuleId || null,
      routingStatus: routing.routingStatus || 'NOT_ROUTED',
      reporterType: getReporterTypeForUser(req.currentUser),
      triageStatus: 'NOT_TRIAGED',
      triageNotes: '',
      triagedByUserId: null,
      triagedAt: null,
      executionMode: 'NATIVE',
      executionState: 'NOT_STARTED',
      jiraDraft: resolvedJira.config ? {
        projectKey: resolvedJira.config.projectKey || '',
        issueTypeId: resolvedJira.config.issueTypeId || '',
        issueTypeName: resolvedJira.config.issueTypeName || '',
        metadataSource: resolvedJira.source || 'NONE',
        fields: finalJiraFieldValues,
        appliedMappings: []
      } : {
        projectKey: routing.jiraProjectKey || '',
        issueTypeId: '',
        issueTypeName: '',
        metadataSource: 'NONE',
        fields: {},
        appliedMappings: []
      },
      jira: {
        projectKey: resolvedJira.config?.projectKey || routing.jiraProjectKey || '',
        pushStatus: 'NOT_PUSHED',
        pushErrorMessage: ''
      },
      sla: slaSnapshot,
      commitments: commitmentSnapshots,
      slaEvents: [{ eventType: 'SLA_STARTED', at: new Date(), policyName: slaSnapshot.policyName || '', commitmentCount: commitmentSnapshots.length }],
      attachments: [],
      tags: Array.isArray(tags) ? tags : String(tags).split(',').map((item) => item.trim()).filter(Boolean),
      source: customerVisibility === 'INTERNAL_ONLY' ? 'api' : source,
      customerVisibility
    });

    const attachments = await uploadFilesAndBuildAttachments({
      files: req.files,
      tenantId: req.tenant._id,
      issueId: issue._id,
      uploadedBy: req.currentUser._id,
      entityId: issue.entityId
    });
    if (attachments.length) {
      issue.attachments = attachments;
      await issue.save();
    }

    await createIssueActivity({ tenantId: req.tenant._id, issueId: issue._id, entityId: issue.entityId, type: 'ISSUE_CREATED', performedByUserId: req.currentUser._id, performedByRole: getReporterTypeForUser(req.currentUser) });
    if (attachments.length) {
      await createIssueActivity({ tenantId: req.tenant._id, issueId: issue._id, entityId: issue.entityId, type: 'ISSUE_ATTACHMENTS_ADDED', metadata: { count: attachments.length }, performedByUserId: req.currentUser._id, performedByRole: getReporterTypeForUser(req.currentUser) });
    }
    if (routing.routingStatus === 'ROUTED') {
      await createIssueActivity({ tenantId: req.tenant._id, issueId: issue._id, entityId: issue.entityId, type: 'ISSUE_AUTO_ROUTED', metadata: { routingRuleId: routing.routingRuleId ? String(routing.routingRuleId) : null, supportGroupId: routing.supportGroupId ? String(routing.supportGroupId) : null, assignedToUserId: routing.assignedToUserId ? String(routing.assignedToUserId) : null, executionMode: routing.executionMode || 'NATIVE', jiraProjectKey: routing.jiraProjectKey || '' }, performedByUserId: req.currentUser._id, performedByRole: getReporterTypeForUser(req.currentUser) });
    }
    await createIssueActivity({ tenantId: req.tenant._id, issueId: issue._id, entityId: issue.entityId, type: 'ISSUE_EXECUTION_MODE_SET', metadata: { source: routing.routingRuleId ? 'ROUTING_RULE' : 'DEFAULT', routingRuleId: routing.routingRuleId ? String(routing.routingRuleId) : null, after: { executionMode: issue.executionMode, executionState: issue.executionState } }, performedByUserId: req.currentUser._id, performedByRole: getReporterTypeForUser(req.currentUser) });

    if (resolvedJira.config?.isEnabled) {
      await createIssueActivity({ tenantId: req.tenant._id, issueId: issue._id, entityId: issue.entityId, type: 'ENTITY_JIRA_MAPPING_RESOLVED', metadata: { source: resolvedJira.source, projectKey: resolvedJira.config.projectKey, issueTypeId: resolvedJira.config.issueTypeId, issueTypeName: resolvedJira.config.issueTypeName, autoPushOnCreate: !!resolvedJira.config.autoPushOnCreate }, performedByUserId: req.currentUser._id, performedByRole: getReporterTypeForUser(req.currentUser) });
    }
    if (resolvedSlaPolicy) {
      await createIssueActivity({ tenantId: req.tenant._id, issueId: issue._id, entityId: issue.entityId, type: 'SLA_POLICY_APPLIED', metadata: { policyId: String(resolvedSlaPolicy._id), policyName: resolvedSlaPolicy.name, responseTargetMinutes: resolvedSlaPolicy.responseTargetMinutes, resolutionTargetMinutes: resolvedSlaPolicy.resolutionTargetMinutes }, performedByUserId: req.currentUser._id, performedByRole: getReporterTypeForUser(req.currentUser) });
    }

let autoPushErrorMessage = '';
let autoPushQueued = false;
if (resolvedJira.config?.isEnabled && resolvedJira.config.autoPushOnCreate) {
  const missingRequiredFields = validateRequiredJiraFields(metadataResult.fields, finalJiraFieldValues);
  if (missingRequiredFields.length) {
    autoPushErrorMessage = `Missing Jira-required fields: ${missingRequiredFields.join(', ')}`;
    issue.executionState = 'FAILED';
    issue.jira.pushStatus = 'FAILED';
    issue.jira.pushErrorMessage = autoPushErrorMessage;
    await issue.save();
    await createIssueActivity({ tenantId: req.tenant._id, issueId: issue._id, entityId: issue.entityId, type: 'ISSUE_AUTO_PUSH_FAILED', metadata: { reason: autoPushErrorMessage }, performedByUserId: req.currentUser._id, performedByRole: getReporterTypeForUser(req.currentUser) });
  } else if (connection?.isActive && connection.lastValidationStatus === 'SUCCESS') {
    issue.executionMode = 'JIRA';
    issue.executionState = 'READY_FOR_EXECUTION';
    issue.jira.pushStatus = 'NOT_PUSHED';
    issue.jira.pushErrorMessage = '';
    await issue.save();
    await enqueueJiraPush({ tenantId: req.tenant._id, issueId: issue._id, triggeredByUserId: req.currentUser._id, requestedProjectKey: resolvedJira.config.projectKey, issueTypeId: resolvedJira.config.issueTypeId, issueTypeName: resolvedJira.config.issueTypeName });
    await appendJiraLinkEvent({ tenantId: req.tenant._id, issueId: issue._id, jiraIssueId: '', jiraIssueKey: '', projectKey: resolvedJira.config.projectKey, type: 'JIRA_PUSH_ENQUEUED', status: 'QUEUED', detail: 'Auto-push queued from issue creation', payload: { queuedByUserId: String(req.currentUser._id) } });
    await createIssueActivity({ tenantId: req.tenant._id, issueId: issue._id, entityId: issue.entityId, type: 'ISSUE_AUTO_PUSH_QUEUED', metadata: { projectKey: resolvedJira.config.projectKey, issueTypeId: resolvedJira.config.issueTypeId, issueTypeName: resolvedJira.config.issueTypeName }, performedByUserId: req.currentUser._id, performedByRole: getReporterTypeForUser(req.currentUser) });
    autoPushQueued = true;
  }
}

await logAudit({ tenantId: req.tenant._id, actorUserId: req.currentUser._id, action: 'issue.created', entityType: 'issue', entityId: issue._id, after: { issueNumber: issue.issueNumber, entityId: issue.entityId.toString(), status: issue.status, priority: issue.priority, category: issue.category, triageStatus: issue.triageStatus, routingStatus: issue.routingStatus, supportGroupId: issue.supportGroupId ? issue.supportGroupId.toString() : null, assignedToUserId: issue.assignedToUserId ? issue.assignedToUserId.toString() : null, executionMode: issue.executionMode, executionState: issue.executionState, customerVisibility: issue.customerVisibility, attachmentsCount: attachments.length, jiraProjectKey: issue.jiraDraft?.projectKey || '', jiraIssueTypeId: issue.jiraDraft?.issueTypeId || '', appliedMappingsCount: (issue.jiraDraft?.appliedMappings || []).length } });

    const superadmins = await User.find({ tenantId: req.tenant._id, role: 'superadmin', isActive: true }).select('_id').lean();
    await notifyIssueStakeholders({ tenantId: req.tenant._id, issue, type: 'ISSUE_CREATED', actorUserId: req.currentUser._id, subject: `New issue raised · ${issue.issueNumber}`, body: `${issue.issueNumber} was created for ${entity.name}.`, extraUserIds: superadmins.map((item) => item._id) });

    const hydratedIssue = await Issue.findById(issue._id).populate('entityId createdByUserId assignedToUserId lastUpdatedByUserId triagedByUserId supportGroupId');
    if (isApiRequest(req)) return res.status(201).json({ item: issueToJson(hydratedIssue) });
    req.session.success = autoPushErrorMessage ? `Issue created. Jira auto-push did not complete: ${autoPushErrorMessage}` : (autoPushQueued ? 'Issue created and queued for Jira push.' : 'Issue created successfully.');
    const detailBase = req.originalUrl.includes('/client/') ? `${req.basePath}/client/issues` : `${req.basePath}/tickets`;
    return res.redirect(`${detailBase}/${issue._id}`);
  } catch (error) {
    if (isApiRequest(req) && error.status) return res.status(error.status).json({ error: error.message });
    return next(error);
  }
}

async function getIssueOrDeny(req, res, next) {
  try {
    const issue = await Issue.findOne({ _id: req.params.id, tenantId: req.tenant._id })
      .populate('entityId createdByUserId assignedToUserId lastUpdatedByUserId triagedByUserId supportGroupId routingRuleId');

    if (!issue) {
      if (isApiRequest(req)) return res.status(404).json({ error: 'Issue not found.' });
      req.session.error = 'Issue not found.';
      return res.redirect(`${req.basePath}/tickets`);
    }

    if (!(await userHasEntityAccess(req.currentUser, issue.entityId._id)) || !canUserViewIssue(req.currentUser, issue)) {
      if (isApiRequest(req)) return res.status(403).json({ error: 'You do not have access to this issue.' });
      req.session.error = 'You do not have access to this issue.';
      return res.redirect(`${req.basePath}/tickets`);
    }

    req.issue = issue;
    return next();
  } catch (error) {
    if (error instanceof mongoose.Error.CastError) {
      if (isApiRequest(req)) return res.status(404).json({ error: 'Issue not found.' });
      req.session.error = 'Issue not found.';
      return res.redirect(`${req.basePath}/tickets`);
    }
    return next(error);
  }
}

async function buildCommentItems(req) {
  const visibilityFilter = getCommentVisibilityFilter(req.currentUser);
  const comments = await IssueComment.find({
    tenantId: req.tenant._id,
    issueId: req.issue._id,
    entityId: req.issue.entityId._id,
    ...visibilityFilter
  })
    .select('issueId entityId commentText authorUserId authorRole visibility attachments createdAt updatedAt')
    .populate('authorUserId', 'name')
    .sort({ createdAt: -1 })
    .lean();

  return comments.map((comment) => { comment.tenantSlug = req.tenant.slug; return commentToJson(comment); });
}

async function buildHistoryItems(req) {
  const activities = await IssueActivity.find({
    tenantId: req.tenant._id,
    issueId: req.issue._id,
    entityId: req.issue.entityId._id,
    type: { $ne: 'COMMENT_ADDED' }
  })
    .select('issueId entityId type metadata performedByUserId performedByRole createdAt')
    .populate('performedByUserId', 'name')
    .sort({ createdAt: -1 })
    .lean();

  return activities.map(historyActivityToJson);
}

async function viewIssuePage(req, res, next) {
  try {
    const issue = req.issue;
    evaluateIssueSla(issue);
    const [agents, comments, historyItems, jiraLink, auditTrail, jiraConnection] = await Promise.all([
      getAssignableAgentsForEntity({ tenantId: req.tenant._id, entityId: issue.entityId._id }),
      buildCommentItems(req),
      buildHistoryItems(req),
      getJiraLinkByIssueId({ issueId: issue._id }),
      AuditLog.find({ tenantId: req.tenant._id, $or: [{ entityType: 'issue', entityId: issue._id }, { entityType: 'issue_comment', 'after.issueId': String(issue._id), ...(req.currentUser.role === 'client' ? { 'after.visibility': 'EXTERNAL' } : {}) }] }).populate('actorUserId', 'name email role').sort({ createdAt: -1 }).limit(12).lean(),
      getTenantJiraConnection({ tenantId: req.tenant._id, includeSecret: false }).catch(() => null)
    ]);
    return res.render('tickets/detail', {
      title: issue.issueNumber,
      issue: issueToJson(Object.assign(issue, { tenantSlug: req.tenant.slug })),
      agents,
      statuses: ISSUE_STATUSES,
      priorities: ISSUE_PRIORITIES,
      triageStatuses: TRIAGE_STATUSES,
      allowedStatusTransitions: getAllowedStatusTransitions(req.currentUser, issue.status),
      comments,
      historyItems,
      jiraLink: jiraLink || null,
      canAssignIssue: canAssignIssue(req.currentUser),
      canChangeStatus: canChangeIssueStatus(req.currentUser),
      canTriageIssue: canTriageIssue(req.currentUser),
      canChangeExecutionMode: canChangeExecutionMode(req.currentUser),
      executionModes: EXECUTION_MODES,
      executionStates: EXECUTION_STATES,
      commentForm: getCommentFormOptions(req.currentUser),
      uploadLimits: getUploadUiConfig(),
      auditTrail,
      jiraConnection: jiraConnection ? serializeConnection(jiraConnection) : null
    });
  } catch (error) {
    return next(error);
  }
}

async function listIssuesApi(req, res, next) {
  try {
    const filter = await buildIssueFilter(req);
    if (filter.entityId && typeof filter.entityId === 'string' && !(await userHasEntityAccess(req.currentUser, filter.entityId))) {
      return res.status(403).json({ error: 'You do not have access to the selected entity.' });
    }
    const items = await Issue.find(filter)
      .populate('entityId createdByUserId assignedToUserId triagedByUserId')
      .sort({ updatedAt: -1 });
    items.forEach((item) => evaluateIssueSla(item));
    return res.json({ items: items.map((item) => issueToJson(Object.assign(item, { tenantSlug: req.tenant.slug }))) });
  } catch (error) {
    return next(error);
  }
}

async function getIssueApi(req, res) {
  evaluateIssueSla(req.issue);
  return res.json({ item: issueToJson(Object.assign(req.issue, { tenantSlug: req.tenant.slug })) });
}

async function updateIssueStatus(req, res, next) {
  try {
    if (!canChangeIssueStatus(req.currentUser)) {
      const message = 'You cannot change issue status.';
      if (isApiRequest(req)) return res.status(403).json({ error: message });
      req.session.error = message;
      return res.redirect(`${req.basePath}/tickets/${req.params.id}`);
    }

    const { status } = req.body;
    if (!ISSUE_STATUSES.includes(status)) {
      const message = 'Status is invalid.';
      if (isApiRequest(req)) return res.status(400).json({ error: message });
      req.session.error = message;
      return res.redirect(`${req.basePath}/tickets/${req.params.id}`);
    }

    const beforeStatus = req.issue.status;
    if (beforeStatus === status) {
      if (isApiRequest(req)) return res.json({ item: issueToJson(req.issue) });
      req.session.success = 'Issue status already set.';
      return res.redirect(`${req.basePath}/tickets/${req.issue._id}`);
    }

    const allowedTransitions = getAllowedStatusTransitions(req.currentUser, beforeStatus);
    const workflow = await WorkflowConfig.findOne({ tenantId: req.tenant._id }).lean();
    const workflowRule = workflow?.transitions?.find((item) => item.fromStatus === beforeStatus && item.toStatus === status);
    if (workflowRule && !(workflowRule.rolesAllowed || []).includes(req.currentUser.role)) {
      const message = 'Workflow policy blocks this transition for your role.';
      if (isApiRequest(req)) return res.status(403).json({ error: message });
      req.session.error = message;
      return res.redirect(`${req.basePath}/tickets/${req.issue._id}`);
    }
    if (workflowRule?.requiresApproval) {
      const message = 'This transition requires approval flow in v25.4.';
      if (isApiRequest(req)) return res.status(409).json({ error: message });
      req.session.error = message;
      return res.redirect(`${req.basePath}/tickets/${req.issue._id}`);
    }
    if (!allowedTransitions.includes(status)) {
      const message = `You cannot move an issue from ${beforeStatus} to ${status}.`;
      if (isApiRequest(req)) return res.status(403).json({ error: message });
      req.session.error = message;
      return res.redirect(`${req.basePath}/tickets/${req.issue._id}`);
    }

    if (status === 'CLOSED' && req.issue.executionMode === 'JIRA' && !req.issue.closure?.awaitingAgentClosure && req.issue.jira?.issueKey) {
      const message = 'Jira-executed issues can be closed only after Jira resolution sync and agent confirmation.';
      if (isApiRequest(req)) return res.status(409).json({ error: message });
      req.session.error = message;
      return res.redirect(`${req.basePath}/tickets/${req.issue._id}`);
    }
    req.issue.status = status;
    if (status === 'WAITING_FOR_CLIENT') pauseIssueSla(req.issue); else resumeIssueSla(req.issue);
    if (status === 'CLOSED') {
      req.issue.closure = req.issue.closure || {};
      req.issue.closure.awaitingAgentClosure = false;
      req.issue.closure.closedByUserId = req.currentUser._id;
      req.issue.closure.closedAt = new Date();
    }
    req.issue.lastUpdatedByUserId = req.currentUser._id;
    await syncSlaForIssue(req.issue, { changedStatus: true });
    syncCommitmentsFromPrimarySla(req.issue);
    await req.issue.save();

    const reopened = ['RESOLVED', 'CLOSED'].includes(beforeStatus) && status === 'OPEN';
    await createIssueActivity({
      tenantId: req.tenant._id,
      issueId: req.issue._id,
      entityId: req.issue.entityId._id,
      type: reopened ? 'ISSUE_REOPENED' : 'STATUS_CHANGED',
      metadata: { before: beforeStatus, after: req.issue.status },
      performedByUserId: req.currentUser._id,
      performedByRole: getReporterTypeForUser(req.currentUser)
    });
    if (['RESOLVED', 'CLOSED'].includes(req.issue.status) && req.issue.sla?.resolvedAt) {
      await createIssueActivity({
        tenantId: req.tenant._id,
        issueId: req.issue._id,
        entityId: req.issue.entityId._id,
        type: 'SLA_RESOLUTION_MET',
        metadata: { resolvedAt: req.issue.sla.resolvedAt },
        performedByUserId: req.currentUser._id,
        performedByRole: getReporterTypeForUser(req.currentUser)
      });
    }

    await logAudit({
      tenantId: req.tenant._id,
      actorUserId: req.currentUser._id,
      action: reopened ? 'issue.reopened' : 'issue.status.updated',
      entityType: 'issue',
      entityId: req.issue._id,
      before: { status: beforeStatus },
      after: { status: req.issue.status }
    });

    await notifyIssueStakeholders({ tenantId: req.tenant._id, issue: req.issue, type: reopened ? 'ISSUE_REOPENED' : 'ISSUE_STATUS_CHANGED', actorUserId: req.currentUser._id, subject: `${req.issue.issueNumber} status updated`, body: `Status moved from ${beforeStatus} to ${req.issue.status}.` });

    if (isApiRequest(req)) return res.json({ item: issueToJson(req.issue) });
    req.session.success = reopened ? 'Issue reopened.' : 'Issue status updated.';
    return res.redirect(`${req.basePath}/tickets/${req.issue._id}`);
  } catch (error) {
    return next(error);
  }
}

async function assignIssue(req, res, next) {
  try {
    if (!canAssignIssue(req.currentUser)) {
      const message = 'Only agents or superadmins can assign issues.';
      if (isApiRequest(req)) return res.status(403).json({ error: message });
      req.session.error = message;
      return res.redirect(`${req.basePath}/tickets/${req.params.id}`);
    }

    if (req.currentUser.role === 'agent' && !(await userHasEntityAccess(req.currentUser, req.issue.entityId._id))) {
      const message = 'You do not have access to assign this issue.';
      if (isApiRequest(req)) return res.status(403).json({ error: message });
      req.session.error = message;
      return res.redirect(`${req.basePath}/tickets/${req.params.id}`);
    }

    const { assignedToUserId } = req.body;
    const assignee = await validateAssignableAgentForEntity({
      tenantId: req.tenant._id,
      agentUserId: assignedToUserId,
      entityId: req.issue.entityId._id
    });

    const beforeAssignedToUserId = normalizeId(req.issue.assignedToUserId);
    const beforeName = req.issue.assignedToUserId
      ? (req.issue.assignedToUserId.name || req.issue.assignedToUserId.email || String(req.issue.assignedToUserId._id || req.issue.assignedToUserId))
      : 'Unassigned';
    const afterName = assignee.name || assignee.email || assignee._id.toString();

    req.issue.assignedToUserId = assignee._id;
    req.issue.lastUpdatedByUserId = req.currentUser._id;
    await req.issue.save();

    await createIssueActivity({
      tenantId: req.tenant._id,
      issueId: req.issue._id,
      entityId: req.issue.entityId._id,
      type: 'ASSIGNED',
      metadata: {
        before: beforeName,
        after: afterName,
        beforeAssignedToUserId,
        afterAssignedToUserId: assignee._id.toString()
      },
      performedByUserId: req.currentUser._id,
      performedByRole: getReporterTypeForUser(req.currentUser)
    });

    await logAudit({
      tenantId: req.tenant._id,
      actorUserId: req.currentUser._id,
      action: 'issue.assigned',
      entityType: 'issue',
      entityId: req.issue._id,
      before: { assignedToName: beforeName, assignedToUserId: beforeAssignedToUserId },
      after: { assignedToName: afterName, assignedToUserId: assignee._id.toString() }
    });

    await notifyIssueStakeholders({ tenantId: req.tenant._id, issue: req.issue, type: 'ISSUE_ASSIGNED', actorUserId: req.currentUser._id, subject: `${req.issue.issueNumber} assigned`, body: `${req.issue.issueNumber} is now assigned to ${afterName}.`, extraUserIds: [assignee._id] });

    if (isApiRequest(req)) {
      const hydratedIssue = await Issue.findById(req.issue._id).populate('entityId createdByUserId assignedToUserId lastUpdatedByUserId triagedByUserId supportGroupId');
      return res.json({ item: issueToJson(hydratedIssue) });
    }

    req.session.success = 'Issue assigned successfully.';
    return res.redirect(`${req.basePath}/tickets/${req.issue._id}`);
  } catch (error) {
    if (isApiRequest(req)) {
      if (error.status) return res.status(error.status).json({ error: error.message });
    } else if (error.status && error.status < 500) {
      req.session.error = error.message;
      return res.redirect(`${req.basePath}/tickets/${req.params.id}`);
    }
    return next(error);
  }
}

async function triageIssue(req, res, next) {
  try {
    if (!canTriageIssue(req.currentUser)) {
      const message = 'Only agents or superadmins can triage issues.';
      if (isApiRequest(req)) return res.status(403).json({ error: message });
      req.session.error = message;
      return res.redirect(`${req.basePath}/tickets/${req.params.id}`);
    }

    if (req.currentUser.role === 'agent' && !(await userHasEntityAccess(req.currentUser, req.issue.entityId._id))) {
      const message = 'You do not have access to triage this issue.';
      if (isApiRequest(req)) return res.status(403).json({ error: message });
      req.session.error = message;
      return res.redirect(`${req.basePath}/tickets/${req.params.id}`);
    }

    const before = {
      category: req.issue.category,
      priority: req.issue.priority,
      status: req.issue.status,
      triageStatus: req.issue.triageStatus,
      triageNotes: req.issue.triageNotes || '',
      assignedToUserId: normalizeId(req.issue.assignedToUserId)
    };

    const category = typeof req.body.category === 'string' && req.body.category.trim() ? req.body.category.trim() : req.issue.category;
    const priority = typeof req.body.priority === 'string' && req.body.priority.trim()
      ? req.body.priority.trim().toUpperCase()
      : req.issue.priority;
    const triageNotes = typeof req.body.triageNotes === 'string' ? req.body.triageNotes.trim() : (req.issue.triageNotes || '');
    const nextStatus = typeof req.body.status === 'string' && req.body.status.trim() ? req.body.status.trim() : null;
    const assignedToUserId = typeof req.body.assignedToUserId === 'string' && req.body.assignedToUserId.trim() ? req.body.assignedToUserId.trim() : null;
    const markTriaged = req.body.markTriaged === true || req.body.markTriaged === 'true' || req.body.markTriaged === '1' || req.body.markTriaged === 1 || !nextStatus;

    if (!category) throw badRequest('category is required for triage.');
    if (!ISSUE_PRIORITIES.includes(priority)) throw badRequest('priority is invalid.');
    if (nextStatus && !ISSUE_STATUSES.includes(nextStatus)) throw badRequest('status is invalid.');

    let assignee = null;
    if (assignedToUserId) {
      assignee = await validateAssignableAgentForEntity({
        tenantId: req.tenant._id,
        agentUserId: assignedToUserId,
        entityId: req.issue.entityId._id
      });
    }

    const triageStarted = req.issue.triageStatus === 'NOT_TRIAGED';
    if (triageStarted) {
      req.issue.triageStatus = 'IN_TRIAGE';
      await createIssueActivity({
        tenantId: req.tenant._id,
        issueId: req.issue._id,
        entityId: req.issue.entityId._id,
        type: 'TRIAGE_STARTED',
        performedByUserId: req.currentUser._id,
        performedByRole: getReporterTypeForUser(req.currentUser)
      });
    }

    req.issue.category = category;
    req.issue.priority = priority;
    req.issue.triageNotes = triageNotes;
    req.issue.lastUpdatedByUserId = req.currentUser._id;

    if (assignee) req.issue.assignedToUserId = assignee._id;

    if (nextStatus) {
      const allowedTransitions = getAllowedStatusTransitions(req.currentUser, req.issue.status);
      const workflow = await WorkflowConfig.findOne({ tenantId: req.tenant._id }).lean();
      const workflowRule = workflow?.transitions?.find((item) => item.fromStatus === req.issue.status && item.toStatus === nextStatus);
      if (workflowRule && !(workflowRule.rolesAllowed || []).includes(req.currentUser.role)) throw forbidden('Workflow policy blocks this transition for your role.');
      if (workflowRule?.requiresApproval) throw badRequest('This transition requires approval flow in v25.4.');
      if (!allowedTransitions.includes(nextStatus) && nextStatus !== req.issue.status) {
        throw forbidden(`You cannot move an issue from ${req.issue.status} to ${nextStatus} during triage.`);
      }
      req.issue.status = nextStatus;
      if (nextStatus === 'WAITING_FOR_CLIENT') { pauseIssueSla(req.issue); appendSlaEvent(req.issue, 'SLA_PAUSED', { reason: 'WAITING_FOR_CLIENT' }); } else { resumeIssueSla(req.issue); appendSlaEvent(req.issue, 'SLA_RESUMED', { reason: nextStatus }); }
    }

    if (markTriaged) {
      req.issue.triageStatus = 'TRIAGED';
      req.issue.triagedByUserId = req.currentUser._id;
      req.issue.triagedAt = new Date();
      await createIssueActivity({
        tenantId: req.tenant._id,
        issueId: req.issue._id,
        entityId: req.issue.entityId._id,
        type: 'TRIAGE_COMPLETED',
        metadata: {
          category: req.issue.category,
          priority: req.issue.priority,
          assignedToUserId: normalizeId(req.issue.assignedToUserId),
          status: req.issue.status
        },
        performedByUserId: req.currentUser._id,
        performedByRole: getReporterTypeForUser(req.currentUser)
      });
    }

    await syncSlaForIssue(req.issue, { changedStatus: !!nextStatus });
    syncCommitmentsFromPrimarySla(req.issue);
    await req.issue.save();

    await logAudit({
      tenantId: req.tenant._id,
      actorUserId: req.currentUser._id,
      action: 'issue.triaged',
      entityType: 'issue',
      entityId: req.issue._id,
      before,
      after: {
        category: req.issue.category,
        priority: req.issue.priority,
        status: req.issue.status,
        triageStatus: req.issue.triageStatus,
        triageNotes: req.issue.triageNotes,
        assignedToUserId: normalizeId(req.issue.assignedToUserId),
        triagedByUserId: normalizeId(req.issue.triagedByUserId),
        triagedAt: req.issue.triagedAt
      }
    });

    const hydratedIssue = await Issue.findById(req.issue._id).populate('entityId createdByUserId assignedToUserId lastUpdatedByUserId triagedByUserId supportGroupId');
    if (isApiRequest(req)) return res.json({ item: issueToJson(hydratedIssue) });
    req.session.success = markTriaged ? 'Issue triaged successfully.' : 'Triage progress saved.';
    return res.redirect(`${req.basePath}/tickets/${req.issue._id}`);
  } catch (error) {
    if (isApiRequest(req)) {
      if (error.status) return res.status(error.status).json({ error: error.message });
    } else if (error.status && error.status < 500) {
      req.session.error = error.message;
      return res.redirect(`${req.basePath}/tickets/${req.params.id}`);
    }
    return next(error);
  }
}


async function updateExecutionMode(req, res, next) {
  try {
    if (!canChangeExecutionMode(req.currentUser)) {
      const message = 'Only agents or superadmins can change execution mode.';
      if (isApiRequest(req)) return res.status(403).json({ error: message });
      req.session.error = message;
      return res.redirect(`${req.basePath}/tickets/${req.params.id}`);
    }

    if (req.currentUser.role === 'agent' && !(await userHasEntityAccess(req.currentUser, req.issue.entityId._id))) {
      const message = 'You do not have access to change execution mode for this issue.';
      if (isApiRequest(req)) return res.status(403).json({ error: message });
      req.session.error = message;
      return res.redirect(`${req.basePath}/tickets/${req.params.id}`);
    }

    const requestedMode = String(req.body.executionMode || '').trim().toUpperCase();
    if (!EXECUTION_MODES.includes(requestedMode)) {
      const message = 'Execution mode is invalid.';
      if (isApiRequest(req)) return res.status(400).json({ error: message });
      req.session.error = message;
      return res.redirect(`${req.basePath}/tickets/${req.params.id}`);
    }

    const before = { executionMode: req.issue.executionMode || 'NATIVE', executionState: req.issue.executionState || 'NOT_STARTED' };
    const nextState = req.issue.executionState === 'NOT_STARTED' ? 'READY_FOR_EXECUTION' : req.issue.executionState;

    if (before.executionMode === requestedMode && before.executionState === nextState) {
      const hydratedIssue = await Issue.findById(req.issue._id).populate('entityId createdByUserId assignedToUserId lastUpdatedByUserId triagedByUserId supportGroupId');
      if (isApiRequest(req)) return res.json({ item: issueToJson(Object.assign(hydratedIssue, { tenantSlug: req.tenant.slug })) });
      req.session.success = 'Execution mode already set.';
      return res.redirect(`${req.basePath}/tickets/${req.issue._id}`);
    }

    req.issue.executionMode = requestedMode;
    req.issue.executionState = nextState;
    if (!req.issue.jira) req.issue.jira = {};
    if (requestedMode === 'NATIVE') {
      req.issue.jira.pushStatus = req.issue.jira.issueKey ? req.issue.jira.pushStatus : 'NOT_PUSHED';
      req.issue.jira.pushErrorMessage = '';
    }
    req.issue.lastUpdatedByUserId = req.currentUser._id;
    await req.issue.save();

    await createIssueActivity({
      tenantId: req.tenant._id,
      issueId: req.issue._id,
      entityId: req.issue.entityId._id,
      type: 'ISSUE_EXECUTION_MODE_SET',
      metadata: {
        source: 'MANUAL_OVERRIDE',
        before,
        after: { executionMode: req.issue.executionMode, executionState: req.issue.executionState }
      },
      performedByUserId: req.currentUser._id,
      performedByRole: getReporterTypeForUser(req.currentUser)
    });

    await logAudit({
      tenantId: req.tenant._id,
      actorUserId: req.currentUser._id,
      action: 'issue.execution_mode.updated',
      entityType: 'issue',
      entityId: req.issue._id,
      before,
      after: { executionMode: req.issue.executionMode, executionState: req.issue.executionState }
    });

    const hydratedIssue = await Issue.findById(req.issue._id).populate('entityId createdByUserId assignedToUserId lastUpdatedByUserId triagedByUserId supportGroupId');
    if (isApiRequest(req)) return res.json({ item: issueToJson(Object.assign(hydratedIssue, { tenantSlug: req.tenant.slug })) });
    req.session.success = 'Execution mode updated.';
    return res.redirect(`${req.basePath}/tickets/${req.issue._id}`);
  } catch (error) {
    if (isApiRequest(req)) {
      if (error.status) return res.status(error.status).json({ error: error.message });
    } else if (error.status && error.status < 500) {
      req.session.error = error.message;
      return res.redirect(`${req.basePath}/tickets/${req.params.id}`);
    }
    return next(error);
  }
}



function resolveJiraProjectKey(issue, connection, requestedProjectKey = '') {
  const intakeConfig = getIntakeConfig(connection);
  if (intakeConfig.isActive && intakeConfig.minimalMode) return intakeConfig.projectKey;
  return String(
    requestedProjectKey || issue.jiraDraft?.projectKey || issue.jira?.projectKey || issue.routingRuleId?.jiraProjectKey || connection?.projectKeyDefault || ''
  ).trim().toUpperCase();
}

async function resolveJiraIssueType(tenant, issue, connection, projectKey, requestedIssueTypeId = '', requestedIssueTypeName = '') {
  const intakeConfig = getIntakeConfig(connection);
  if (intakeConfig.isActive && intakeConfig.minimalMode) {
    return { issueTypeId: '', issueTypeName: intakeConfig.issueTypeName };
  }
  const rawIssueTypeId = String(
    requestedIssueTypeId || issue.jiraDraft?.issueTypeId || issue.jira?.issueTypeId || connection?.issueTypeIdDefault || ''
  ).trim();
  const rawIssueTypeName = String(
    requestedIssueTypeName || issue.jiraDraft?.issueTypeName || issue.jira?.issueTypeName || connection?.issueTypeNameDefault || ''
  ).trim();
  return resolveIssueTypeForProject(connection, projectKey, rawIssueTypeId, rawIssueTypeName);
}


async function validateQueueableJiraPush({ tenant, issue, requestedProjectKey = '', requestedIssueTypeId = '', requestedIssueTypeName = '' }) {
  const connection = await getTenantJiraConnection({ tenantId: tenant._id, includeSecret: true });
  if (!connection || !connection.isActive) throw badRequest('Active Jira configuration is required before pushing issues.');
  if (connection.lastValidationStatus !== 'SUCCESS') throw badRequest('Jira configuration must be validated before pushing issues.');

  const projectKey = resolveJiraProjectKey(issue, connection, requestedProjectKey);
  const { issueTypeId, issueTypeName } = await resolveJiraIssueType(tenant, issue, connection, projectKey, requestedIssueTypeId, requestedIssueTypeName);
  if (!projectKey) throw badRequest('No Jira project key could be resolved for this issue.');
  if (!issueTypeId && !issueTypeName) throw badRequest('No Jira issue type could be resolved for this issue.');

  const intakeConfig = getIntakeConfig(connection);
  if (intakeConfig.isActive && intakeConfig.minimalMode) {
    return { connection, projectKey, issueTypeId, issueTypeName, metadataFields: [] };
  }

  const metadataResult = await getJiraMetadataForIssueContext({
    tenantId: tenant._id,
    entityId: issue.entityId?._id || issue.entityId,
    resolvedConfig: { projectKey, issueTypeId, issueTypeName },
    connection
  });
  const missingRequiredFields = validateRequiredJiraFields(metadataResult.fields || [], issue.jiraDraft?.fields || {});
  if (missingRequiredFields.length) throw badRequest(`Missing Jira-required fields: ${missingRequiredFields.join(', ')}`);

  return { connection, projectKey, issueTypeId, issueTypeName, metadataFields: metadataResult.fields || [] };
}


async function syncIssueFromJira(req, res, next) {
  try {
    if (!['agent', 'superadmin'].includes(req.currentUser.role)) {
      const message = 'Only agents or superadmins can refresh Jira status.';
      if (isApiRequest(req)) return res.status(403).json({ error: message });
      req.session.error = message;
      return res.redirect(`${req.basePath}/tickets/${req.params.id}`);
    }

    if (!req.issue.jira?.issueKey) {
      const message = 'This issue has not been pushed to Jira yet.';
      if (isApiRequest(req)) return res.status(400).json({ error: message });
      req.session.error = message;
      return res.redirect(`${req.basePath}/tickets/${req.params.id}`);
    }

    const connection = await getTenantJiraConnection({ tenantId: req.tenant._id, includeSecret: true });
    if (!connection || !connection.isActive) {
      const message = 'Active Jira configuration is required before refreshing Jira status.';
      if (isApiRequest(req)) return res.status(400).json({ error: message });
      req.session.error = message;
      return res.redirect(`${req.basePath}/tickets/${req.params.id}`);
    }

    let jiraStatusName = '';
    let jiraStatusCategory = '';
    let refreshSource = 'MANUAL_REFRESH';

    if (isMockMode()) {
      jiraStatusName = String(req.body?.mockStatus || req.query?.mockStatus || req.issue.jira?.currentStatusName || 'Done').trim();
      jiraStatusCategory = String(req.body?.mockStatusCategory || req.query?.mockStatusCategory || (jiraStatusName.toUpperCase().includes('DONE') || jiraStatusName.toUpperCase().includes('CLOSE') ? 'DONE' : 'TO_DO')).trim();
      refreshSource = 'MANUAL_REFRESH_MOCK';
    } else {
      const response = await jiraRequest({
        baseUrl: connection.baseUrl,
        method: 'GET',
        path: `/rest/api/3/issue/${encodeURIComponent(req.issue.jira.issueKey)}?fields=status`,
        email: connection.email,
        apiToken: connection.apiToken
      });
      jiraStatusName = String(response.data?.fields?.status?.name || '').trim();
      jiraStatusCategory = String(response.data?.fields?.status?.statusCategory?.key || response.data?.fields?.status?.statusCategory?.name || '').trim();
    }

    const { mappedStatus, beforeStatus } = syncIssueStateFromJiraStatus(req.issue, jiraStatusName, jiraStatusCategory, refreshSource);
    req.issue.lastUpdatedByUserId = req.currentUser._id;
    await req.issue.save();

    await appendJiraLinkEvent({
      tenantId: req.tenant._id,
      issueId: req.issue._id,
      jiraIssueId: req.issue.jira?.issueId || '',
      jiraIssueKey: req.issue.jira?.issueKey || '',
      projectKey: req.issue.jira?.projectKey || '',
      type: 'JIRA_STATUS_REFRESH',
      status: 'SYNCED',
      detail: `Jira status ${jiraStatusName || 'Unknown'} mapped to ${mappedStatus === 'READY_TO_CLOSE' ? 'Closed for Review' : mappedStatus}`,
      payload: { source: refreshSource, jiraStatusName, jiraStatusCategory, beforeStatus, afterStatus: mappedStatus }
    });

    await createIssueActivity({
      tenantId: req.tenant._id,
      issueId: req.issue._id,
      entityId: req.issue.entityId?._id || req.issue.entityId,
      type: 'JIRA_STATUS_REFRESH',
      metadata: { before: beforeStatus, after: mappedStatus, jiraIssueKey: req.issue.jira?.issueKey || '', jiraStatusName, jiraStatusCategory, source: refreshSource },
      performedByUserId: req.currentUser._id,
      performedByRole: getReporterTypeForUser(req.currentUser)
    });

    await logAudit({
      tenantId: req.tenant._id,
      actorUserId: req.currentUser._id,
      action: 'jira.status.refresh',
      entityType: 'issue',
      entityId: req.issue._id,
      after: { jiraIssueKey: req.issue.jira?.issueKey || '', jiraStatusName, jiraStatusCategory, beforeStatus, afterStatus: mappedStatus, source: refreshSource }
    }).catch(() => null);

    if (isApiRequest(req)) return res.status(200).json({ ok: true, item: issueToJson(req.issue), jiraStatusName, jiraStatusCategory, mappedStatus });
    req.session.success = `Jira status refreshed: ${jiraStatusName || 'Unknown'} → ${mappedStatus === 'READY_TO_CLOSE' ? 'Closed for Review' : mappedStatus}`;
    return res.redirect(`${req.basePath}/tickets/${req.issue._id}`);
  } catch (error) {
    if (isApiRequest(req) && error.status) return res.status(error.status).json({ error: error.message });
    if (!isApiRequest(req)) {
      req.session.error = `Jira refresh failed: ${error.message}`;
      return res.redirect(`${req.basePath}/tickets/${req.params.id}`);
    }
    return next(error);
  }
}

async function pushIssueToJira(req, res, next) {
  try {
    if (!['agent', 'superadmin'].includes(req.currentUser.role)) {
      const message = 'Only agents or superadmins can push issues to Jira.';
      if (isApiRequest(req)) return res.status(403).json({ error: message });
      req.session.error = message;
      return res.redirect(`${req.basePath}/tickets/${req.params.id}`);
    }

    if (req.issue.jira?.pushStatus === 'PUSHED' || req.issue.jira?.issueKey) {
      const message = 'Issue already pushed to Jira.';
      if (isApiRequest(req)) return res.status(409).json({ error: message });
      req.session.error = message;
      return res.redirect(`${req.basePath}/tickets/${req.params.id}`);
    }

    const requestedProjectKey = String(req.body?.projectKey || '').trim().toUpperCase();
    const requestedIssueTypeId = String(req.body?.issueTypeId || '').trim();
    const requestedIssueTypeName = String(req.body?.issueTypeName || '').trim();
    const { connection, projectKey, issueTypeId, issueTypeName } = await validateQueueableJiraPush({
      tenant: req.tenant,
      issue: req.issue,
      requestedProjectKey,
      requestedIssueTypeId,
      requestedIssueTypeName
    });

    if (process.env.JIRA_MOCK_MODE === 'true') {
      const mockKey = `${projectKey}-1001`;

      req.issue.jira = req.issue.jira || {};
      req.issue.jira.projectKey = projectKey;
      req.issue.jira.issueKey = mockKey;
      req.issue.jira.issueId = mockKey;
      req.issue.jira.issueUrl = getJiraBrowseUrl(connection, mockKey) || `https://mock-jira.local/browse/${mockKey}`;
      req.issue.jira.currentStatusName = 'Created in Jira';
      req.issue.jira.currentStatusCategory = 'TO_DO';
      req.issue.jira.statusLastSyncedAt = new Date();
      req.issue.jira.pushedAt = new Date();
      req.issue.jira.pushedByUserId = req.currentUser._id;
      req.issue.jira.pushStatus = 'PUSHED';
      req.issue.jira.pushErrorMessage = '';

      req.issue.executionMode = 'JIRA';
      req.issue.executionState = 'PUSHED_TO_JIRA';
      req.issue.lastUpdatedByUserId = req.currentUser._id;
      req.issue.jiraDraft.projectKey = projectKey;
      req.issue.jiraDraft.issueTypeId = issueTypeId;
      req.issue.jiraDraft.issueTypeName = issueTypeName;

      await req.issue.save();

      await createIssueActivity({
        tenantId: req.tenant._id,
        issueId: req.issue._id,
        entityId: req.issue.entityId._id,
        type: 'ISSUE_SENT_TO_JIRA',
        metadata: { projectKey, jiraIssueKey: mockKey, mockMode: true },
        performedByUserId: req.currentUser._id,
        performedByRole: getReporterTypeForUser(req.currentUser)
      });

      const hydratedIssue = await Issue.findById(req.issue._id)
        .populate('entityId createdByUserId assignedToUserId lastUpdatedByUserId triagedByUserId supportGroupId');

      return res.status(200).json({
        queued: false,
        item: issueToJson(Object.assign(hydratedIssue, { tenantSlug: req.tenant.slug }))
      });
    }

    req.issue.jira = req.issue.jira || {};
    req.issue.jira.projectKey = projectKey;
    req.issue.jira.pushStatus = 'NOT_PUSHED';
    req.issue.jira.pushErrorMessage = '';
    req.issue.jira.outboundRequestKey = req.issue.jira.outboundRequestKey || crypto.createHash('sha1').update(String(req.issue._id)).digest('hex');
    req.issue.jira.outboundState = 'QUEUED';
    req.issue.jira.outboundAttemptedAt = new Date();
    req.issue.executionMode = 'JIRA';
    req.issue.executionState = 'READY_FOR_EXECUTION';
    req.issue.lastUpdatedByUserId = req.currentUser._id;
    req.issue.jiraDraft.projectKey = projectKey;
    req.issue.jiraDraft.issueTypeId = issueTypeId;
    req.issue.jiraDraft.issueTypeName = issueTypeName;
    await req.issue.save();

    await enqueueJiraPush({ tenantId: req.tenant._id, issueId: req.issue._id, triggeredByUserId: req.currentUser._id, requestedProjectKey: projectKey, issueTypeId, issueTypeName });
    await appendJiraLinkEvent({ tenantId: req.tenant._id, issueId: req.issue._id, jiraIssueId: req.issue.jira?.issueId || '', jiraIssueKey: req.issue.jira?.issueKey || '', projectKey, type: 'JIRA_PUSH_ENQUEUED', status: 'QUEUED', detail: 'Issue queued for async Jira push', payload: { queuedByUserId: String(req.currentUser._id) } });
    await createIssueActivity({ tenantId: req.tenant._id, issueId: req.issue._id, entityId: req.issue.entityId._id, type: 'ISSUE_MANUAL_PUSH_QUEUED', metadata: { projectKey, issueTypeId, issueTypeName }, performedByUserId: req.currentUser._id, performedByRole: getReporterTypeForUser(req.currentUser) });

    if (isApiRequest(req)) return res.status(202).json({ queued: true, item: issueToJson(req.issue) });
    req.session.success = 'Issue queued for Jira push.';
    return res.redirect(`${req.basePath}/tickets/${req.issue._id}`);
  } catch (error) {
    if (isApiRequest(req) && error.status) return res.status(error.status).json({ error: error.message });
    if (error.status && !isApiRequest(req)) {
      req.session.error = error.message;
      return res.redirect(`${req.basePath}/tickets/${req.params.id}`);
    }
    return next(error);
  }
}

async function getIssueJiraSyncHistory(req, res, next) {
  try {
    const jiraLink = await getJiraLinkByIssueId({ issueId: req.issue._id });
    return res.json({ item: jiraLink || null, events: jiraLink?.events || [] });
  } catch (error) {
    return next(error);
  }
}

async function createComment(req, res, next) {
  try {
    const commentText = String(req.body.commentText || '').trim();
    const visibility = String(req.body.visibility || 'EXTERNAL').toUpperCase();
    if (!commentText) throw badRequest('commentText is required.');
    if (!COMMENT_VISIBILITIES.includes(visibility)) throw badRequest('visibility is invalid.');
    if (req.currentUser.role === 'client' && visibility !== 'EXTERNAL') throw forbidden('Client users can only create EXTERNAL comments.');
    if (!['client', 'agent', 'superadmin'].includes(req.currentUser.role)) throw forbidden('You cannot comment on issues.');

    const comment = await IssueComment.create({
      tenantId: req.tenant._id,
      issueId: req.issue._id,
      entityId: req.issue.entityId._id,
      commentText,
      authorUserId: req.currentUser._id,
      authorRole: getReporterTypeForUser(req.currentUser),
      visibility,
      attachments: []
    });

    const hadFirstResponse = !!req.issue.sla?.firstRespondedAt;
    await syncSlaForIssue(req.issue, { commentActor: req.currentUser, commentVisibility: visibility });

    const attachments = await uploadFilesAndBuildAttachments({
      files: req.files,
      tenantId: req.tenant._id,
      issueId: req.issue._id,
      uploadedBy: req.currentUser._id,
      commentId: comment._id,
      entityId: req.issue.entityId._id
    });
    if (attachments.length) {
      comment.attachments = attachments;
      await comment.save();
    }

    req.issue.lastUpdatedByUserId = req.currentUser._id;
    await req.issue.save();

    await createIssueActivity({
      tenantId: req.tenant._id,
      issueId: req.issue._id,
      entityId: req.issue.entityId._id,
      type: 'COMMENT_ADDED',
      metadata: {
        commentId: comment._id.toString(),
        visibility: comment.visibility,
        attachmentsCount: attachments.length
      },
      performedByUserId: req.currentUser._id,
      performedByRole: getReporterTypeForUser(req.currentUser)
    });
    syncCommitmentsFromPrimarySla(req.issue);
    if (!hadFirstResponse && req.issue.sla?.firstRespondedAt) {
      appendSlaEvent(req.issue, 'SLA_FIRST_RESPONSE_MET', { firstRespondedAt: req.issue.sla.firstRespondedAt });
      await req.issue.save();
      await createIssueActivity({
        tenantId: req.tenant._id,
        issueId: req.issue._id,
        entityId: req.issue.entityId._id,
        type: 'SLA_FIRST_RESPONSE_MET',
        metadata: { firstRespondedAt: req.issue.sla.firstRespondedAt },
        performedByUserId: req.currentUser._id,
        performedByRole: getReporterTypeForUser(req.currentUser)
      });
    }

    if (attachments.length) {
      await createIssueActivity({
        tenantId: req.tenant._id,
        issueId: req.issue._id,
        entityId: req.issue.entityId._id,
        type: 'COMMENT_ATTACHMENTS_ADDED',
        metadata: { commentId: comment._id.toString(), count: attachments.length },
        performedByUserId: req.currentUser._id,
        performedByRole: getReporterTypeForUser(req.currentUser)
      });
    }

    await logAudit({
      tenantId: req.tenant._id,
      actorUserId: req.currentUser._id,
      action: 'issue.comment.created',
      entityType: 'issue_comment',
      entityId: comment._id,
      after: { issueId: req.issue._id.toString(), visibility: comment.visibility, attachmentsCount: attachments.length }
    });

    await notifyIssueStakeholders({ tenantId: req.tenant._id, issue: req.issue, type: 'ISSUE_COMMENT_ADDED', actorUserId: req.currentUser._id, subject: `${req.issue.issueNumber} has a new comment`, body: `${req.currentUser.name || req.currentUser.email} added a ${comment.visibility.toLowerCase()} comment.` });

    const hydrated = await IssueComment.findById(comment._id).populate('authorUserId', 'name');
    if (isApiRequest(req)) return res.status(201).json({ item: commentToJson(hydrated) });
    req.session.success = 'Comment added successfully.';
    return res.redirect(`${req.basePath}/tickets/${req.issue._id}`);
  } catch (error) {
    if (isApiRequest(req)) {
      if (error.status) return res.status(error.status).json({ error: error.message });
    } else if (error.status && error.status < 500) {
      req.session.error = error.message;
      return res.redirect(`${req.basePath}/tickets/${req.params.id}`);
    }
    return next(error);
  }
}

async function listComments(req, res, next) {
  try {
    return res.json({ items: await buildCommentItems(req) });
  } catch (error) {
    return next(error);
  }
}

async function getTimeline(req, res, next) {
  try {
    return res.json({ items: await buildHistoryItems(req) });
  } catch (error) {
    return next(error);
  }
}

async function exportIssuesExcel(req, res, next) {
  try {
    const defaultView = await SavedView.findOne({ tenantId: req.tenant._id, userId: req.currentUser._id, isDefault: true }).lean();
    const baseQuery = defaultView?.filters ? { ...defaultView.filters, ...req.query } : req.query;
    const sort = normalizeIssuesSort(baseQuery.sortBy, baseQuery.sortDir);
    const filter = applyCustomerVisibilityFilter({ tenantId: req.tenant._id }, req.currentUser);
    if (req.currentUser.role === 'client' || req.currentUser.role === 'agent') {
      const scopeIds = await getAccessibleEntityIdsForUser(req.currentUser);
      filter.entityId = { $in: scopeIds.length ? scopeIds : [] };
    }
    if (baseQuery.q) {
      filter.$or = [
        { issueNumber: new RegExp(`^${escapeRegex(baseQuery.q)}`, 'i') },
        { title: new RegExp(escapeRegex(baseQuery.q), 'i') },
        { description: new RegExp(escapeRegex(baseQuery.q), 'i') },
        { tags: new RegExp(escapeRegex(baseQuery.q), 'i') }
      ];
    }
    if (baseQuery.entityId) filter.entityId = baseQuery.entityId;
    if (baseQuery.status) filter.status = baseQuery.status;
    if (baseQuery.priority) filter.priority = baseQuery.priority;
    if (baseQuery.triageStatus) filter.triageStatus = baseQuery.triageStatus;
    if (baseQuery.assignedToUserId) filter.assignedToUserId = baseQuery.assignedToUserId;
    if (baseQuery.createdByUserId) filter.createdByUserId = baseQuery.createdByUserId;
    if (baseQuery.executionMode) filter.executionMode = baseQuery.executionMode;
    if (baseQuery.routingStatus) filter.routingStatus = baseQuery.routingStatus;
    if (baseQuery.customerVisibility && req.currentUser.role !== 'client') filter.customerVisibility = baseQuery.customerVisibility;
    if (baseQuery.product) filter.product = baseQuery.product;
    if (baseQuery.slaStatus) filter.$and = [{ $or: [{ 'sla.responseStatus': baseQuery.slaStatus }, { 'sla.resolutionStatus': baseQuery.slaStatus }] }];
    const createdFrom = parseDateOnly(baseQuery.createdFrom);
    const createdTo = parseDateOnly(baseQuery.createdTo, { endOfDay: true });
    if (createdFrom || createdTo) {
      filter.createdAt = {};
      if (createdFrom) filter.createdAt.$gte = createdFrom;
      if (createdTo) filter.createdAt.$lte = createdTo;
    }

    const issues = await Issue.find(filter)
      .populate('entityId assignedToUserId createdByUserId')
      .sort(sort.sortSpec);

    const headers = ['Issue', 'Title', 'Entity', 'Product', 'Status', 'Jira Key', 'Jira Status', 'Priority', 'Triage', 'Assigned To', 'Created By', 'Created On', 'Resolved On'];
    const rows = buildIssueExportRows(issues);
    const format = String(req.query.format || 'xls').toLowerCase();
    if (format === 'csv') {
      return sendCsv(res, `issues-${req.tenant.slug}.csv`, headers, rows);
    }
    const xml = rowsToExcelXml({ worksheetName: 'Issues', headers, rows });
    return sendExcelXml(res, `issues-${req.tenant.slug}.xls`, xml);
  } catch (error) {
    return next(error);
  }
}



async function bulkUpdateIssues(req, res, next) {
  try {
    if (!['agent', 'superadmin'].includes(req.currentUser.role)) return res.status(403).json({ error: 'Only agents or superadmins can bulk update issues.' });
    const issueIds = Array.isArray(req.body.issueIds) ? req.body.issueIds : [];
    const action = String(req.body.action || '').trim().toUpperCase();
    const payload = req.body.payload || {};
    const resolvedStatus = payload.status || req.body.status || '';
    const resolvedAssignedToUserId = payload.assignedToUserId || req.body.assignedToUserId || null;
    const resolvedExecutionMode = payload.executionMode || req.body.executionMode || '';
    const resolvedTriageStatus = payload.triageStatus || req.body.triageStatus || '';
    const resolvedTags = Array.isArray(payload.tags) ? payload.tags : (Array.isArray(req.body.tags) ? req.body.tags : ((payload.tags || req.body.tags) ? String(payload.tags || req.body.tags).split(',').map((t) => t.trim()).filter(Boolean) : null));
    const issues = await Issue.find({ tenantId: req.tenant._id, _id: { $in: issueIds } }).populate('entityId assignedToUserId');
    let updatedCount = 0;
    const skipped = [];

    for (const issue of issues) {
      try {
        if (!(await userHasEntityAccess(req.currentUser, issue.entityId._id)) || !canUserViewIssue(req.currentUser, issue)) {
          skipped.push({ issueId: String(issue._id), reason: 'NO_ENTITY_ACCESS' });
          continue;
        }

        let changed = false;
        let changedStatus = false;

        const shouldApplyStatus = action === 'CHANGE_STATUS' || (!action && !!resolvedStatus);
        if (shouldApplyStatus && resolvedStatus) {
          if (!ISSUE_STATUSES.includes(resolvedStatus)) {
            skipped.push({ issueId: String(issue._id), reason: 'INVALID_STATUS' });
            continue;
          }
          if (resolvedStatus !== issue.status) {
            const allowedTransitions = getAllowedStatusTransitions(req.currentUser, issue.status);
            if (!allowedTransitions.includes(resolvedStatus)) {
              skipped.push({ issueId: String(issue._id), reason: 'INVALID_TRANSITION' });
              continue;
            }
            if (resolvedStatus === 'CLOSED' && issue.executionMode === 'JIRA' && !issue.closure?.awaitingAgentClosure && issue.jira?.issueKey) {
              skipped.push({ issueId: String(issue._id), reason: 'JIRA_AGENT_CLOSURE_REQUIRED' });
              continue;
            }
            issue.status = resolvedStatus;
            changed = true;
            changedStatus = true;
          }
        }

        const shouldApplyAssignment = action === 'ASSIGN' || (!action && !!resolvedAssignedToUserId);
        if (shouldApplyAssignment && resolvedAssignedToUserId) {
          const assignee = await validateAssignableAgentForEntity({ tenantId: req.tenant._id, agentUserId: resolvedAssignedToUserId, entityId: issue.entityId._id });
          if (String(issue.assignedToUserId || '') !== String(assignee._id)) {
            issue.assignedToUserId = assignee._id;
            changed = true;
          }
        }

        const shouldApplyExecution = action === 'SET_EXECUTION_MODE' || action === 'EXECUTION_MODE' || (!action && !!resolvedExecutionMode);
        if (shouldApplyExecution && resolvedExecutionMode) {
          if (!EXECUTION_MODES.includes(resolvedExecutionMode)) {
            skipped.push({ issueId: String(issue._id), reason: 'INVALID_EXECUTION_MODE' });
            continue;
          }
          if (issue.executionMode !== resolvedExecutionMode) {
            issue.executionMode = resolvedExecutionMode;
            if (resolvedExecutionMode === 'NATIVE') {
              issue.executionState = 'NOT_STARTED';
            } else if (issue.jira?.issueKey) {
              issue.executionState = 'PUSHED_TO_JIRA';
            } else {
              issue.executionState = 'READY_FOR_EXECUTION';
            }
            changed = true;
          }
        }

        const shouldApplyTriage = action === 'SET_TRIAGE_STATUS' || action === 'TRIAGE' || (!action && !!resolvedTriageStatus);
        if (shouldApplyTriage && resolvedTriageStatus) {
          if (!TRIAGE_STATUSES.includes(resolvedTriageStatus)) {
            skipped.push({ issueId: String(issue._id), reason: 'INVALID_TRIAGE_STATUS' });
            continue;
          }
          if (issue.triageStatus !== resolvedTriageStatus) {
            issue.triageStatus = resolvedTriageStatus;
            issue.triagedByUserId = ['IN_TRIAGE', 'TRIAGED'].includes(resolvedTriageStatus) ? req.currentUser._id : issue.triagedByUserId;
            issue.triagedAt = ['IN_TRIAGE', 'TRIAGED'].includes(resolvedTriageStatus) ? new Date() : issue.triagedAt;
            changed = true;
          }
        }

        const shouldApplyTags = action === 'ADD_TAGS' || (!action && !!resolvedTags);
        if (shouldApplyTags && resolvedTags && resolvedTags.length) {
          const mergedTags = Array.from(new Set([...(issue.tags || []), ...resolvedTags]));
          if (mergedTags.length !== (issue.tags || []).length) {
            issue.tags = mergedTags;
            changed = true;
          }
        }

        if (!changed) {
          skipped.push({ issueId: String(issue._id), reason: 'NO_CHANGES_APPLIED' });
          continue;
        }

        issue.lastUpdatedByUserId = req.currentUser._id;
        await syncSlaForIssue(issue, { changedStatus });
        await issue.save();
        updatedCount += 1;
      } catch (error) {
        skipped.push({ issueId: String(issue._id), reason: error.status ? error.message : 'UPDATE_FAILED' });
      }
    }
    return res.json({ ok: true, requestedCount: issueIds.length, updatedCount, skippedCount: skipped.length, skipped });
  } catch (error) { return next(error); }
}

module.exports = {
  listIssuesPage,
  showCreateIssue,
  createIssue,
  getIssueOrDeny,
  viewIssuePage,
  listIssuesApi,
  getIssueApi,
  updateIssueStatus,
  assignIssue,
  triageIssue,
  updateExecutionMode,
  createComment,
  listComments,
  getTimeline,
  pushIssueToJira,
  syncIssueFromJira,
  getIssueJiraSyncHistory,
  exportIssuesExcel,
  bulkUpdateIssues
};
