const mongoose = require('mongoose');

const ISSUE_ACTIVITY_TYPES = [
  'ISSUE_CREATED', 'COMMENT_ADDED', 'STATUS_CHANGED', 'ASSIGNED', 'ISSUE_REOPENED',
  'ISSUE_ATTACHMENTS_ADDED', 'COMMENT_ATTACHMENTS_ADDED', 'TRIAGE_STARTED', 'TRIAGE_COMPLETED',
  'ISSUE_AUTO_ROUTED', 'ISSUE_EXECUTION_MODE_SET', 'ISSUE_SENT_TO_JIRA', 'ISSUE_AUTO_PUSH_QUEUED',
  'ISSUE_AUTO_PUSH_FAILED', 'ISSUE_MANUAL_PUSH_QUEUED', 'ENTITY_JIRA_MAPPING_RESOLVED',
  'JIRA_FIELD_MAPPING_APPLIED', 'SLA_POLICY_APPLIED', 'SLA_FIRST_RESPONSE_MET', 'SLA_RESOLUTION_MET',
  'SLA_RESPONSE_BREACHED', 'SLA_RESOLUTION_BREACHED', 'WEBHOOK_SYNC', 'AGENT_CLOSURE_REQUIRED',
  'JIRA_PUSH_CONFIRMED_EXISTING', 'JIRA_WEBHOOK_REJECTED', 'JIRA_STATUS_REFRESH'
];

const issueActivitySchema = new mongoose.Schema(
  {
    tenantId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
    issueId: { type: mongoose.Schema.Types.ObjectId, ref: 'Issue', required: true, index: true },
    entityId: { type: mongoose.Schema.Types.ObjectId, ref: 'Entity', required: true, index: true },
    type: { type: String, enum: ISSUE_ACTIVITY_TYPES, required: true, index: true },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
    performedByUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    performedByRole: { type: String, enum: ['client_user', 'agent', 'superadmin', 'system'], required: true }
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

issueActivitySchema.index({ tenantId: 1, issueId: 1, entityId: 1, createdAt: -1 });
issueActivitySchema.index({ tenantId: 1, entityId: 1, type: 1, createdAt: -1 });

const IssueActivity = mongoose.model('IssueActivity', issueActivitySchema);

module.exports = { IssueActivity, ISSUE_ACTIVITY_TYPES };
