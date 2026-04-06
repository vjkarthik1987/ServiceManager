const crypto = require('crypto');
const { Issue } = require('../../issues/issue.model');
const { JiraWebhookEvent } = require('./jira-webhook-event.model');
const { appendJiraLinkEvent } = require('./jira-link.service');
const { getTenantJiraConnection } = require('./jira-connection.service');
const { createNotification } = require('../../notifications/notification.service');
const { createIssueActivity } = require('../../issues/issue.service');
const { evaluateIssueSla } = require('../../sla/sla.service');
const { logAudit } = require('../../audit/audit.service');

function mapWebhookStatus(raw) {
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

function deriveWebhookMappedStatus({ rawStatus = '', jiraStatusName = '', jiraStatusCategory = '', fallbackStatus = 'OPEN' } = {}) {
  const normalizedCategory = String(jiraStatusCategory || '').trim().toLowerCase();
  if (['done', 'complete', 'completed'].includes(normalizedCategory)) return 'READY_TO_CLOSE';
  return mapWebhookStatus(rawStatus || jiraStatusName || jiraStatusCategory || fallbackStatus);
}

function getCurrentJiraStatusInfo(body = {}) {
  const issueStatus = body?.issue?.fields?.status || body?.issue?.status || {};
  const changelogItems = Array.isArray(body?.changelog?.items) ? body.changelog.items : [];
  const statusChange = changelogItems.find((item) => String(item.field || '').toLowerCase() === 'status');

  const name = String(
    issueStatus?.name ||
    statusChange?.toString ||
    statusChange?.to ||
    body?.transition?.to_status ||
    body?.status ||
    ''
  ).trim();

  const category = String(
    issueStatus?.statusCategory?.key ||
    issueStatus?.statusCategory?.name ||
    ''
  ).trim();

  return { name, category };
}

function extractRawStatus(body = {}) {
  const candidates = [
    body?.issue?.fields?.status?.name,
    body?.issue?.status?.name,
    body?.transition?.to_status,
    body?.status,
    body?.issue_event_type_name
  ];

  const changelogItems = Array.isArray(body?.changelog?.items) ? body.changelog.items : [];
  const statusChange = changelogItems.find((item) => String(item.field || '').toLowerCase() === 'status');
  if (statusChange) {
    candidates.unshift(statusChange.toString || statusChange.to || statusChange.toStringValue || statusChange.fromString);
  }

  return String(candidates.find((item) => String(item || '').trim()) || '').trim();
}

function buildEventIdentity(req) {
  const issueKey = String(req.body?.issue?.key || '');
  const issueId = String(req.body?.issue?.id || '');
  const rawStatus = extractRawStatus(req.body);
  const fallbackSource = JSON.stringify({
    webhookEvent: req.body?.webhookEvent || '',
    issueKey,
    rawStatus,
    changelog: req.body?.changelog || null,
    timestamp: req.body?.timestamp || null
  });
  const fingerprint = crypto.createHash('sha256').update(fallbackSource).digest('hex');
  const headerId = String(req.headers['x-atlassian-webhook-identifier'] || '').trim();
  const eventId = headerId || fingerprint;
  return { eventId, fingerprint, issueKey, issueId, rawStatus };
}

async function isWebhookAuthentic(req) {
  const connection = await getTenantJiraConnection({ tenantId: req.tenant?._id, includeSecret: true }).catch(() => null);
  const configuredSecret = String(connection?.webhookSecret || process.env.JIRA_WEBHOOK_SECRET || '').trim();
  if (!configuredSecret) return true;
  const provided = String(req.headers['x-esop-webhook-secret'] || req.headers['x-jira-webhook-secret'] || '').trim();
  if (!provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(configuredSecret);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

async function receiveJiraWebhook(req, res, next) {
  try {
    const tenantId = req.tenant?._id;
    const { eventId, fingerprint, issueKey, issueId, rawStatus } = buildEventIdentity(req);
    const jiraStatus = getCurrentJiraStatusInfo(req.body);

    if (!(await isWebhookAuthentic(req))) {
      await createIssueActivity({ tenantId, issueId: null, entityId: req.tenant?._id, type: 'JIRA_WEBHOOK_REJECTED', metadata: { eventId, issueKey }, performedByUserId: req.currentUser?._id || req.tenant?._id, performedByRole: 'system' }).catch(() => null);
      return res.status(401).json({ ok: false, error: 'Invalid webhook secret' });
    }

    try {
      await JiraWebhookEvent.create({ tenantId, eventId, fingerprint, issueKey, payload: req.body });
    } catch (error) {
      if (error?.code === 11000) return res.json({ ok: true, duplicate: true });
      throw error;
    }

    if (!issueKey && !issueId) return res.json({ ok: true, ignored: true });

    const issue = await Issue.findOne({
      tenantId,
      $or: [
        ...(issueKey ? [{ 'jira.issueKey': issueKey }] : []),
        ...(issueId ? [{ 'jira.issueId': issueId }] : [])
      ]
    });
    if (!issue) return res.json({ ok: true, ignored: true, reason: 'Issue not found', issueKey, issueId });

    const beforeStatus = issue.status;
    const mappedStatus = deriveWebhookMappedStatus({ rawStatus, jiraStatusName: jiraStatus.name, jiraStatusCategory: jiraStatus.category, fallbackStatus: issue.status });
    issue.jira = issue.jira || {};
    issue.jira.pushStatus = 'PUSHED';
    issue.jira.lastWebhookVerifiedAt = new Date();
    issue.jira.currentStatusName = jiraStatus.name || issue.jira.currentStatusName || rawStatus || '';
    issue.jira.currentStatusCategory = jiraStatus.category || issue.jira.currentStatusCategory || '';
    issue.jira.statusLastSyncedAt = new Date();
    issue.executionState = 'SYNCED';
    issue.status = mappedStatus;
    if (mappedStatus === 'READY_TO_CLOSE') {
      issue.closure = issue.closure || {};
      issue.closure.awaitingAgentClosure = true;
      issue.closure.jiraResolvedAt = new Date();
    }
    if (!['READY_TO_CLOSE', 'CLOSED'].includes(mappedStatus)) {
      issue.closure = issue.closure || {};
      issue.closure.awaitingAgentClosure = false;
    }
    if (issue.sla) {
      if (['READY_TO_CLOSE', 'CLOSED'].includes(mappedStatus) && !issue.sla.resolvedAt) issue.sla.resolvedAt = new Date();
      if (!['READY_TO_CLOSE', 'CLOSED'].includes(mappedStatus)) issue.sla.resolvedAt = null;
      evaluateIssueSla(issue);
    }
    await issue.save();

    await appendJiraLinkEvent({ tenantId, issueId: issue._id, jiraIssueId: issue.jira?.issueId || '', jiraIssueKey: issueKey, projectKey: issue.jira?.projectKey || '', type: 'WEBHOOK_SYNC', status: 'SYNCED', detail: `Jira status ${issue.jira.currentStatusName || rawStatus || 'Unknown'} mapped to ${mappedStatus === 'READY_TO_CLOSE' ? 'Closed for Review' : mappedStatus}`, payload: req.body, lastWebhookEventId: eventId });
    await createIssueActivity({ tenantId, issueId: issue._id, entityId: issue.entityId, type: 'WEBHOOK_SYNC', metadata: { before: beforeStatus, after: mappedStatus, jiraIssueKey: issueKey, jiraStatusName: issue.jira.currentStatusName || '', jiraStatusCategory: issue.jira.currentStatusCategory || '', webhookEventId: eventId }, performedByUserId: issue.lastUpdatedByUserId || issue.createdByUserId, performedByRole: 'system' });
    if (mappedStatus === 'READY_TO_CLOSE') {
      await createIssueActivity({ tenantId, issueId: issue._id, entityId: issue.entityId, type: 'AGENT_CLOSURE_REQUIRED', metadata: { jiraIssueKey: issueKey }, performedByUserId: issue.lastUpdatedByUserId || issue.createdByUserId, performedByRole: 'system' });
      await createNotification({ tenantId, issueId: issue._id, type: 'AGENT_CLOSURE_REQUIRED', recipientUserId: issue.assignedToUserId || null, subject: `Agent closure required for ${issue.issueNumber}`, body: `Jira issue ${issueKey} is in a closed/completed state and ESOP is now marked Closed for Review.` });
    }
    await logAudit({ tenantId, actorUserId: issue.lastUpdatedByUserId || issue.createdByUserId, action: 'jira.webhook.synced', entityType: 'issue', entityId: issue._id, after: { beforeStatus, afterStatus: mappedStatus, jiraStatusName: issue.jira.currentStatusName || '', jiraStatusCategory: issue.jira.currentStatusCategory || '', webhookEventId: eventId, issueKey } }).catch(() => null);

    return res.json({ ok: true, issueId: String(issue._id), mappedStatus, jiraStatusName: issue.jira.currentStatusName || '', jiraStatusCategory: issue.jira.currentStatusCategory || '' });
  } catch (error) {
    return next(error);
  }
}

module.exports = { receiveJiraWebhook, mapWebhookStatus, buildEventIdentity, extractRawStatus, getCurrentJiraStatusInfo };
