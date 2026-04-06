const crypto = require('crypto');
const { QueueJob } = require('./job.model');
const { Issue } = require('../issues/issue.model');
const { getTenantJiraConnection } = require('../integrations/jira/jira-connection.service');
const { createJiraIssue, uploadJiraAttachment, isMockMode } = require('../integrations/jira/jira.service');
const { appendJiraLinkEvent, markPushAttempt } = require('../integrations/jira/jira-link.service');
const { createNotification, deliverNotification } = require('../notifications/notification.service');
const { Notification } = require('../notifications/notification.model');
const { getCreateFieldMetadata, resolveIssueTypeForProject } = require('../integrations/jira/jira-metadata.service');
const { sanitizeMetadataFields, sanitizeJiraFieldValues } = require('../integrations/jira/jira-field-utils');
const { acquireLease, renewLease, releaseLease } = require('../workers/worker-lease.service');
const { createIssueActivity } = require('../issues/issue.service');

const LOCK_TIMEOUT_MS = Number(process.env.JOB_LOCK_TIMEOUT_MS || 5 * 60 * 1000);
const LEASE_TTL_MS = Number(process.env.WORKER_LEASE_TTL_MS || 30000);
let timer = null;
let recoveryTimer = null;
let leaseTimer = null;


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

async function enqueueJob({ tenantId, type, payload, maxAttempts = 3, delayMs = 0 }) {
  return QueueJob.create({ tenantId, type, payload, maxAttempts, availableAt: new Date(Date.now() + delayMs) });
}

async function enqueueJiraPush({ tenantId, issueId, triggeredByUserId = null, requestedProjectKey = '', issueTypeId = '', issueTypeName = '' }) {
  const job = await enqueueJob({
    tenantId,
    type: 'JIRA_PUSH',
    payload: {
      issueId,
      triggeredByUserId,
      requestedProjectKey: String(requestedProjectKey || '').trim().toUpperCase(),
      issueTypeId: String(issueTypeId || '').trim(),
      issueTypeName: String(issueTypeName || '').trim()
    },
    maxAttempts: 4
  });

  if (isMockMode()) {
    await processJob(job);
    return QueueJob.findById(job._id).catch(() => job);
  }

  return job;
}

async function recoverStaleJobs() {
  const staleBefore = new Date(Date.now() - LOCK_TIMEOUT_MS);
  return QueueJob.updateMany(
    { status: 'PROCESSING', lockedAt: { $lte: staleBefore } },
    { $set: { status: 'PENDING', lockedAt: null, availableAt: new Date() } }
  );
}

async function claimNextJob() {
  return QueueJob.findOneAndUpdate(
    { status: 'PENDING', availableAt: { $lte: new Date() } },
    { $set: { status: 'PROCESSING', lockedAt: new Date() }, $inc: { attempts: 1 } },
    { sort: { availableAt: 1, createdAt: 1 }, new: true }
  );
}

function resolveProjectKey(issue, connection, payload = {}) {
  const intakeConfig = getIntakeConfig(connection);
  if (intakeConfig.isActive && intakeConfig.minimalMode) return intakeConfig.projectKey;
  return String(payload.requestedProjectKey || issue.jiraDraft?.projectKey || issue.jira?.projectKey || connection?.projectKeyDefault || '').trim().toUpperCase();
}

async function resolveIssueType(issue, connection, projectKey, payload = {}) {
  const intakeConfig = getIntakeConfig(connection);
  if (intakeConfig.isActive && intakeConfig.minimalMode) return { issueTypeId: '', issueTypeName: intakeConfig.issueTypeName };
  const rawIssueTypeId = String(payload.issueTypeId || issue.jiraDraft?.issueTypeId || issue.jira?.issueTypeId || connection?.issueTypeIdDefault || '').trim();
  const rawIssueTypeName = String(payload.issueTypeName || issue.jiraDraft?.issueTypeName || issue.jira?.issueTypeName || connection?.issueTypeNameDefault || '').trim();
  return resolveIssueTypeForProject(connection, projectKey, rawIssueTypeId, rawIssueTypeName);
}

async function processJiraPushJob(job) {
  const issue = await Issue.findById(job.payload.issueId).populate('entityId createdByUserId assignedToUserId');
  if (!issue) {
    job.status = 'DONE';
    job.lastError = 'Issue missing';
    job.processedAt = new Date();
    job.lockedAt = null;
    return job.save();
  }

  if (issue.jira?.issueKey) {
    job.status = 'DONE';
    job.lastError = '';
    job.processedAt = new Date();
    job.lockedAt = null;
    return job.save();
  }

  const connection = await getTenantJiraConnection({ tenantId: issue.tenantId, includeSecret: true });
  if (!connection || !connection.isActive) throw new Error('Active Jira configuration is required.');
  const intakeConfig = getIntakeConfig(connection);
  if (connection.lastValidationStatus !== 'SUCCESS') throw new Error('Jira configuration must be validated before pushing issues.');

  const projectKey = resolveProjectKey(issue, connection, job.payload);
  const { issueTypeId, issueTypeName } = await resolveIssueType(issue, connection, projectKey, job.payload);
  if (!projectKey) throw new Error('Jira draft project key missing.');
  if (!issueTypeId && !issueTypeName) throw new Error('Jira draft issue type missing.');

  issue.jiraDraft = issue.jiraDraft || {};
  issue.jira = issue.jira || {};
  issue.jiraDraft.projectKey = projectKey;
  issue.jiraDraft.issueTypeId = issueTypeId;
  issue.jiraDraft.issueTypeName = issueTypeName;
  issue.jira.outboundRequestKey = issue.jira.outboundRequestKey || crypto.createHash('sha1').update(String(issue._id)).digest('hex');
  issue.jira.outboundState = 'IN_FLIGHT';
  issue.jira.outboundAttemptedAt = new Date();
  await issue.save();

  const metadata = (intakeConfig.isActive && intakeConfig.minimalMode)
    ? { fields: [] }
    : issue.jiraDraft.fields && Object.keys(issue.jiraDraft.fields).length
      ? await getCreateFieldMetadata(connection, projectKey, issueTypeId, issueTypeName).catch(() => ({ fields: [] }))
      : { fields: [] };
  const safeMetadataFields = (intakeConfig.isActive && intakeConfig.minimalMode) ? [] : sanitizeMetadataFields(metadata.fields || []);
  const safeJiraFields = (intakeConfig.isActive && intakeConfig.minimalMode) ? {} : sanitizeJiraFieldValues(issue.jiraDraft.fields || {}, safeMetadataFields);
  issue.jiraDraft.fields = safeJiraFields;
  await issue.save();

  const jiraResult = await createJiraIssue({
    connection,
    issue,
    tenantName: '',
    entityName: issue.entityId?.name || '',
    projectKey,
    issueTypeId,
    issueTypeName,
    jiraFields: safeJiraFields,
    metadataFields: safeMetadataFields
  });

  issue.jira.issueKey = String(jiraResult.key || '');
  issue.jira.issueId = String(jiraResult.id || '');
  issue.jira.issueUrl = jiraResult.issueUrl || `${String(connection.baseUrl).replace(/\/+$/, '')}/browse/${jiraResult.key}`;
  issue.jira.projectKey = projectKey;
  issue.jira.currentStatusName = jiraResult.currentStatusName || 'Created in Jira';
  issue.jira.currentStatusCategory = jiraResult.currentStatusCategory || 'TO_DO';
  issue.jira.statusLastSyncedAt = new Date();
  issue.jira.pushedAt = new Date();
  issue.jira.pushedByUserId = job.payload.triggeredByUserId || issue.lastUpdatedByUserId;
  issue.jira.pushStatus = 'PUSHED';
  issue.jira.pushErrorMessage = '';
  issue.jira.outboundState = 'COMPLETED';
  issue.executionMode = 'JIRA';
  issue.executionState = intakeConfig.defaultStatusAfterPush || 'PUSHED_TO_JIRA';
  issue.lastUpdatedByUserId = job.payload.triggeredByUserId || issue.lastUpdatedByUserId || issue.createdByUserId;
  await issue.save();

  const attachmentSync = { status: 'SKIPPED', attemptedAt: new Date(), uploadedCount: 0, failedCount: 0, items: [], lastError: '' };
  if (intakeConfig.pushAttachments && Array.isArray(issue.attachments) && issue.attachments.length) {
    attachmentSync.status = 'UPLOADED';
    for (const attachment of issue.attachments) {
      try {
        const result = await uploadJiraAttachment({
          connection,
          issueIdOrKey: jiraResult.key || jiraResult.id,
          filePath: attachment.storagePath,
          filename: attachment.originalName || attachment.filename || attachment.fileName || 'attachment',
          mimeType: attachment.mimeType || attachment.fileType || 'application/octet-stream'
        });
        attachmentSync.uploadedCount += 1;
        attachmentSync.items.push({ fileName: attachment.originalName || attachment.filename || attachment.fileName || 'attachment', status: 'uploaded', jiraAttachmentId: result?.[0]?.id || '' });
      } catch (error) {
        attachmentSync.failedCount += 1;
        attachmentSync.status = 'PARTIAL';
        attachmentSync.lastError = error.message;
        attachmentSync.items.push({ fileName: attachment.originalName || attachment.filename || attachment.fileName || 'attachment', status: 'failed', error: error.message });
      }
    }
    if (attachmentSync.uploadedCount === 0 && attachmentSync.failedCount > 0) attachmentSync.status = 'FAILED';
    if (attachmentSync.failedCount === 0 && attachmentSync.uploadedCount > 0) attachmentSync.status = 'UPLOADED';
  }
  issue.jira.attachmentsSync = attachmentSync;
  await issue.save();

  await markPushAttempt({ tenantId: issue.tenantId, issueId: issue._id, jiraIssueId: jiraResult.id, jiraIssueKey: jiraResult.key, projectKey, success: true, detail: jiraResult.existing ? 'Existing Jira issue linked after idempotent recovery' : 'Queued push succeeded' });
  await appendJiraLinkEvent({ tenantId: issue.tenantId, issueId: issue._id, jiraIssueId: jiraResult.id, jiraIssueKey: jiraResult.key, projectKey, type: jiraResult.existing ? 'JIRA_PUSH_CONFIRMED_EXISTING' : 'JIRA_PUSH_COMPLETED', status: 'PUSHED', detail: jiraResult.existing ? 'Existing Jira issue detected and linked' : 'Issue push completed from queue', payload: { jobId: String(job._id) } });
  await createIssueActivity({ tenantId: issue.tenantId, issueId: issue._id, entityId: issue.entityId?._id || issue.entityId, type: 'ISSUE_SENT_TO_JIRA', metadata: { jiraIssueKey: jiraResult.key, projectKey, recoveredExisting: !!jiraResult.existing }, performedByUserId: issue.jira.pushedByUserId || issue.createdByUserId?._id || issue.createdByUserId, performedByRole: 'system' });
  await createNotification({ tenantId: issue.tenantId, issueId: issue._id, type: 'JIRA_PUSH_SUCCESS', recipientUserId: issue.assignedToUserId || null, subject: `Issue ${issue.issueNumber} pushed to Jira`, body: jiraResult.key });

  job.status = 'DONE';
  job.processedAt = new Date();
  job.lastError = '';
  job.lockedAt = null;
  return job.save();
}

async function processNotificationDeliveryJob(job) {
  const notification = await Notification.findById(job.payload.notificationId);
  if (!notification) { job.status = 'DONE'; job.processedAt = new Date(); job.lockedAt = null; return job.save(); }
  await deliverNotification(notification);
  job.status = 'DONE'; job.processedAt = new Date(); job.lockedAt = null; return job.save();
}

async function processJob(job) {
  try {
    if (job.type === 'JIRA_PUSH') return await processJiraPushJob(job);
    if (job.type === 'NOTIFICATION_DELIVERY') return await processNotificationDeliveryJob(job);
    job.status = 'DONE';
    job.processedAt = new Date();
    job.lockedAt = null;
    return job.save();
  } catch (error) {
    const nextStatus = job.attempts >= job.maxAttempts ? 'DLQ' : 'PENDING';
    job.status = nextStatus;
    job.lastError = error.message;
    job.lockedAt = null;
    job.availableAt = new Date(Date.now() + Math.min(job.attempts, 5) * 60 * 1000);
    if (nextStatus === 'DLQ') job.processedAt = new Date();
    await job.save();
    if (job.type === 'JIRA_PUSH') {
      const issue = await Issue.findById(job.payload.issueId).catch(() => null);
      if (issue) {
        issue.jira = issue.jira || {};
        issue.jira.issueKey = '';
        issue.jira.issueId = '';
        issue.jira.issueUrl = '';
        issue.jira.pushStatus = 'FAILED';
        issue.jira.pushErrorMessage = error.message;
        issue.jira.outboundState = nextStatus === 'DLQ' ? 'NOT_REQUESTED' : 'QUEUED';
        issue.executionState = 'FAILED';
        await issue.save().catch(() => null);
        await markPushAttempt({ tenantId: issue.tenantId, issueId: issue._id, jiraIssueId: issue.jira?.issueId || '', jiraIssueKey: issue.jira?.issueKey || '', projectKey: issue.jiraDraft?.projectKey || '', success: false, detail: error.message });
        await appendJiraLinkEvent({ tenantId: issue.tenantId, issueId: issue._id, jiraIssueId: issue.jira?.issueId || '', jiraIssueKey: issue.jira?.issueKey || '', projectKey: issue.jiraDraft?.projectKey || '', type: nextStatus === 'DLQ' ? 'JIRA_PUSH_DLQ' : 'JIRA_PUSH_RETRY_SCHEDULED', status: 'FAILED', detail: error.message, payload: { attempts: job.attempts, maxAttempts: job.maxAttempts } });
      }
    }
  }
}

async function runQueueTick() {
  const hasLease = await acquireLease('queue-worker', LEASE_TTL_MS);
  if (!hasLease) return;
  await renewLease('queue-worker', LEASE_TTL_MS).catch(() => null);
  const job = await claimNextJob().catch(() => null);
  if (!job) return;
  await processJob(job);
}

function startQueueWorker() {
  if (timer) return;
  timer = setInterval(() => { runQueueTick().catch(() => null); }, Number(process.env.JOB_WORKER_INTERVAL_MS || 3000));
  recoveryTimer = setInterval(() => { recoverStaleJobs().catch(() => null); }, Math.max(10000, Math.floor(LOCK_TIMEOUT_MS / 2)));
  leaseTimer = setInterval(() => { renewLease('queue-worker', LEASE_TTL_MS).catch(() => null); }, Math.max(5000, Math.floor(LEASE_TTL_MS / 2)));
  [timer, recoveryTimer, leaseTimer].forEach((handle) => { if (handle && typeof handle.unref === 'function') handle.unref(); });
}

async function stopQueueWorker() {
  if (timer) clearInterval(timer);
  if (recoveryTimer) clearInterval(recoveryTimer);
  if (leaseTimer) clearInterval(leaseTimer);
  timer = null;
  recoveryTimer = null;
  leaseTimer = null;
  await releaseLease('queue-worker').catch(() => null);
}

module.exports = { enqueueJob, enqueueJiraPush, startQueueWorker, stopQueueWorker, recoverStaleJobs, runQueueTick };
