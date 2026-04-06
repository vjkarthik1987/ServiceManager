const { Issue } = require('../issues/issue.model');
const { evaluateIssueSla, appendSlaEvent, syncCommitmentsFromPrimarySla } = require('./sla.service');
const { createNotification } = require('../notifications/notification.service');
const { createIssueActivity } = require('../issues/issue.service');
const { acquireLease, renewLease, releaseLease } = require('../workers/worker-lease.service');

const LEASE_TTL_MS = Number(process.env.WORKER_LEASE_TTL_MS || 30000);
let timer = null;
let leaseTimer = null;

async function runSlaSweep() {
  const hasLease = await acquireLease('sla-worker', LEASE_TTL_MS);
  if (!hasLease) return;
  const issues = await Issue.find({ 'sla.hasPolicy': true, status: { $nin: ['CLOSED'] } }).limit(200);
  for (const issue of issues) {
    const prevResponse = issue.sla?.responseStatus;
    const prevResolution = issue.sla?.resolutionStatus;
    evaluateIssueSla(issue);
    syncCommitmentsFromPrimarySla(issue);
    await issue.save();
    if (issue.sla?.responseStatus === 'BREACHED' && prevResponse !== 'BREACHED') {
      appendSlaEvent(issue, 'SLA_RESPONSE_BREACHED', { responseDueAt: issue.sla.responseDueAt });
      await issue.save();
      await createIssueActivity({ tenantId: issue.tenantId, issueId: issue._id, entityId: issue.entityId, type: 'SLA_RESPONSE_BREACHED', metadata: { responseDueAt: issue.sla.responseDueAt }, performedByUserId: issue.lastUpdatedByUserId || issue.createdByUserId, performedByRole: 'system' });
      await createNotification({ tenantId: issue.tenantId, issueId: issue._id, type: 'SLA_RESPONSE_BREACHED', recipientUserId: issue.assignedToUserId || null, metadata: { issueNumber: issue.issueNumber }, templateKey: 'SLA_RESPONSE_BREACHED' });
      for (const email of (issue.sla?.escalationRecipients || [])) { await createNotification({ tenantId: issue.tenantId, issueId: issue._id, type: 'SLA_RESPONSE_ESCALATION', recipientEmail: email, subject: `Escalation: ${issue.issueNumber}`, body: `Response SLA breached for ${issue.issueNumber}` }); }
    }
    if (issue.sla?.resolutionStatus === 'BREACHED' && prevResolution !== 'BREACHED') {
      appendSlaEvent(issue, 'SLA_RESOLUTION_BREACHED', { resolutionDueAt: issue.sla.resolutionDueAt });
      await issue.save();
      await createIssueActivity({ tenantId: issue.tenantId, issueId: issue._id, entityId: issue.entityId, type: 'SLA_RESOLUTION_BREACHED', metadata: { resolutionDueAt: issue.sla.resolutionDueAt }, performedByUserId: issue.lastUpdatedByUserId || issue.createdByUserId, performedByRole: 'system' });
      await createNotification({ tenantId: issue.tenantId, issueId: issue._id, type: 'SLA_RESOLUTION_BREACHED', recipientUserId: issue.assignedToUserId || null, metadata: { issueNumber: issue.issueNumber }, templateKey: 'SLA_RESOLUTION_BREACHED' });
      for (const email of (issue.sla?.escalationRecipients || [])) { await createNotification({ tenantId: issue.tenantId, issueId: issue._id, type: 'SLA_RESOLUTION_ESCALATION', recipientEmail: email, subject: `Escalation: ${issue.issueNumber}`, body: `Resolution SLA breached for ${issue.issueNumber}` }); }
    }
  }
}
function startSlaWorker() {
  if (timer) return;
  timer = setInterval(() => { runSlaSweep().catch(() => null); }, Number(process.env.SLA_SWEEP_INTERVAL_MS || 60000));
  leaseTimer = setInterval(() => { renewLease('sla-worker', LEASE_TTL_MS).catch(() => null); }, Math.max(5000, Math.floor(LEASE_TTL_MS / 2)));
  if (typeof timer.unref === 'function') timer.unref();
  if (typeof leaseTimer?.unref === 'function') leaseTimer.unref();
}
async function stopSlaWorker() {
  if (timer) clearInterval(timer);
  if (leaseTimer) clearInterval(leaseTimer);
  timer = null;
  leaseTimer = null;
  await releaseLease('sla-worker').catch(() => null);
}
module.exports = { startSlaWorker, runSlaSweep, stopSlaWorker };
