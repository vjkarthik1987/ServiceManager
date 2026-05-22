const { JiraLink } = require('./jira-link.model');

async function appendJiraLinkEvent({ tenantId, issueId, jiraIssueId = '', jiraIssueKey = '', projectKey = '', type, status = 'INFO', detail = '', payload = null, lastWebhookEventId = '' }) {
  const update = {
    $set: {
      tenantId,
      jiraIssueId,
      jiraIssueKey,
      projectKey,
      lastSyncAt: new Date(),
      lastSyncStatus: status,
      ...(lastWebhookEventId ? { lastWebhookEventId } : {}),
      ...(status === 'FAILED' ? { lastErrorMessage: detail || '' } : {})
    },
    $push: {
      events: { $each: [{ type, status, detail, payload, createdAt: new Date() }], $slice: -50 }
    }
  };
  return JiraLink.findOneAndUpdate({ issueId }, update, { upsert: true, new: true, setDefaultsOnInsert: true });
}

async function markPushAttempt({ tenantId, issueId, jiraIssueId = '', jiraIssueKey = '', projectKey = '', success = false, detail = '' }) {
  const update = {
    $set: {
      tenantId,
      jiraIssueId,
      jiraIssueKey,
      projectKey,
      lastSyncAt: new Date(),
      lastSyncStatus: success ? 'PUSHED' : 'FAILED',
      lastErrorMessage: success ? '' : (detail || '')
    },
    $inc: { pushAttempts: 1 },
    $push: {
      events: { $each: [{ type: success ? 'PUSH_TO_JIRA' : 'PUSH_TO_JIRA_FAILED', status: success ? 'PUSHED' : 'FAILED', detail, payload: null, createdAt: new Date() }], $slice: -50 }
    }
  };
  return JiraLink.findOneAndUpdate({ issueId }, update, { upsert: true, new: true, setDefaultsOnInsert: true });
}

async function getJiraLinkByIssueId({ issueId }) {
  return JiraLink.findOne({ issueId }).lean();
}

module.exports = { appendJiraLinkEvent, markPushAttempt, getJiraLinkByIssueId };
