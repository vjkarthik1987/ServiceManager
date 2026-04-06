const mongoose = require('mongoose');
const { fileAttachmentSchema } = require('../storage/file-attachment.schema');

const ISSUE_STATUSES = ['NEW', 'OPEN', 'IN_PROGRESS', 'WAITING_FOR_CLIENT', 'RESOLVED', 'READY_TO_CLOSE', 'CLOSED'];
const ISSUE_PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL', 'BLOCKER'];
const ISSUE_SOURCES = ['portal', 'email', 'api', 'future-ready'];
const REPORTER_TYPES = ['client_user', 'agent', 'system', 'superadmin'];
const TRIAGE_STATUSES = ['NOT_TRIAGED', 'IN_TRIAGE', 'TRIAGED'];
const EXECUTION_MODES = ['NATIVE', 'JIRA'];
const EXECUTION_STATES = ['NOT_STARTED', 'READY_FOR_EXECUTION', 'PUSHED_TO_JIRA', 'SYNCED', 'FAILED'];
const CUSTOMER_VISIBILITIES = ['VISIBLE_TO_CUSTOMER', 'INTERNAL_ONLY'];

const issueSchema = new mongoose.Schema(
  {
    tenantId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
    entityId: { type: mongoose.Schema.Types.ObjectId, ref: 'Entity', required: true, index: true },
    issueNumber: { type: String, required: true, index: true },
    supportGroupId: { type: mongoose.Schema.Types.ObjectId, ref: 'SupportGroup', default: null, index: true },
    routingRuleId: { type: mongoose.Schema.Types.ObjectId, ref: 'RoutingRule', default: null },
    routingStatus: { type: String, enum: ['NOT_ROUTED', 'ROUTED', 'NO_MATCH'], default: 'NOT_ROUTED', index: true },

    routingDecision: {
      matched: { type: Boolean, default: false },
      reason: { type: String, default: '' },
      evaluatedAt: { type: Date, default: null },
      trace: { type: [mongoose.Schema.Types.Mixed], default: [] }
    },
    title: { type: String, required: true, trim: true },
    description: { type: String, required: true, trim: true },
    status: { type: String, enum: ISSUE_STATUSES, default: 'NEW', index: true },
    priority: { type: String, enum: ISSUE_PRIORITIES, default: 'MEDIUM', index: true },
    category: { type: String, required: true, trim: true },
    product: { type: String, default: '', trim: true, index: true },
    createdByUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    lastUpdatedByUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    assignedToUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },
    reporterType: { type: String, enum: REPORTER_TYPES, required: true },
    triageStatus: { type: String, enum: TRIAGE_STATUSES, default: 'NOT_TRIAGED', index: true },
    triageNotes: { type: String, default: '', trim: true },
    triagedByUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    triagedAt: { type: Date, default: null },
    executionMode: { type: String, enum: EXECUTION_MODES, default: 'NATIVE', index: true },
    executionState: { type: String, enum: EXECUTION_STATES, default: 'NOT_STARTED', index: true },

    jiraDraft: {
      projectKey: { type: String, default: '', uppercase: true },
      issueTypeId: { type: String, default: '' },
      issueTypeName: { type: String, default: '' },
      metadataSource: { type: String, default: 'NONE' },
      fields: { type: mongoose.Schema.Types.Mixed, default: {} },
      appliedMappings: { type: [mongoose.Schema.Types.Mixed], default: [] }
    },
    jira: {
      issueKey: { type: String, default: '' },
      issueId: { type: String, default: '' },
      issueUrl: { type: String, default: '' },
      projectKey: { type: String, default: '', uppercase: true },
      currentStatusName: { type: String, default: '' },
      currentStatusCategory: { type: String, default: '' },
      statusLastSyncedAt: { type: Date, default: null },
      pushedAt: { type: Date, default: null },
      pushedByUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
      pushStatus: { type: String, enum: ['NOT_PUSHED', 'PUSHED', 'FAILED'], default: 'NOT_PUSHED' },
      pushErrorMessage: { type: String, default: '' },
      outboundRequestKey: { type: String, default: '', index: true },
      outboundState: { type: String, enum: ['NOT_REQUESTED', 'QUEUED', 'IN_FLIGHT', 'COMPLETED'], default: 'NOT_REQUESTED', index: true },
      outboundAttemptedAt: { type: Date, default: null },
      lastWebhookVerifiedAt: { type: Date, default: null },
      attachmentsSync: {
        status: { type: String, enum: ['NOT_ATTEMPTED', 'UPLOADED', 'PARTIAL', 'FAILED', 'SKIPPED'], default: 'NOT_ATTEMPTED' },
        attemptedAt: { type: Date, default: null },
        uploadedCount: { type: Number, default: 0 },
        failedCount: { type: Number, default: 0 },
        items: { type: [mongoose.Schema.Types.Mixed], default: [] },
        lastError: { type: String, default: '' }
      }
    },
    sla: {
      hasPolicy: { type: Boolean, default: false },
      policyId: { type: mongoose.Schema.Types.ObjectId, ref: 'SlaPolicy', default: null },
      policyName: { type: String, default: '' },
      agreementType: { type: String, default: 'SLA' },
      scopeLevel: { type: String, default: 'GLOBAL' },
      severity: { type: String, default: '' },
      allTargets: { type: [mongoose.Schema.Types.Mixed], default: [] },
      responseTargetMinutes: { type: Number, default: null },
      resolutionTargetMinutes: { type: Number, default: null },
      warningThresholdPercent: { type: Number, default: 80 },
      responseDueAt: { type: Date, default: null },
      resolutionDueAt: { type: Date, default: null },
      firstRespondedAt: { type: Date, default: null },
      respondedByUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
      resolvedAt: { type: Date, default: null },
      responseStatus: { type: String, enum: ['NO_SLA', 'ON_TRACK', 'AT_RISK', 'MET', 'BREACHED'], default: 'NO_SLA', index: true },
      resolutionStatus: { type: String, enum: ['NO_SLA', 'ON_TRACK', 'AT_RISK', 'MET', 'BREACHED'], default: 'NO_SLA', index: true },
      breachedAt: {
        response: { type: Date, default: null },
        resolution: { type: Date, default: null }
      },
      pausedAt: { type: Date, default: null },
      totalPausedMinutes: { type: Number, default: 0 },
      stageTargets: { type: [mongoose.Schema.Types.Mixed], default: [] },
      stageStatus: { type: [mongoose.Schema.Types.Mixed], default: [] },
      escalationRecipients: { type: [String], default: [] },
      updateEveryMinutes: { type: Number, default: null },
      acknowledgementTargetMinutes: { type: Number, default: null },
      workaroundTargetMinutes: { type: Number, default: null },
      closureConfirmationTargetMinutes: { type: Number, default: null },
      businessHoursMode: { type: String, default: 'TWENTY_FOUR_SEVEN' },
      holidayCalendar: { type: [String], default: [] },
      lastEvaluatedAt: { type: Date, default: null }
    },

    commitments: { type: [mongoose.Schema.Types.Mixed], default: [] },
    slaEvents: { type: [mongoose.Schema.Types.Mixed], default: [] },

    closure: {
      awaitingAgentClosure: { type: Boolean, default: false },
      jiraResolvedAt: { type: Date, default: null },
      closedByUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
      closedAt: { type: Date, default: null }
    },
    attachments: { type: [fileAttachmentSchema], default: [] },
    tags: { type: [String], default: [] },
    source: { type: String, enum: ISSUE_SOURCES, default: 'portal' },
    customerVisibility: { type: String, enum: CUSTOMER_VISIBILITIES, default: 'VISIBLE_TO_CUSTOMER', index: true }
  },
  { timestamps: true }
);

issueSchema.index({ tenantId: 1, issueNumber: 1 }, { unique: true });
issueSchema.index({ tenantId: 1, entityId: 1, status: 1, priority: 1, assignedToUserId: 1, triageStatus: 1 });
issueSchema.index({ tenantId: 1, createdByUserId: 1 });
issueSchema.index({ tenantId: 1, issueNumber: 1, title: 1 });
issueSchema.index({ tenantId: 1, supportGroupId: 1, routingStatus: 1, createdAt: -1 });
issueSchema.index({ tenantId: 1, 'sla.responseStatus': 1, 'sla.resolutionStatus': 1 });
issueSchema.index({ tenantId: 1, 'jira.outboundRequestKey': 1 }, { partialFilterExpression: { 'jira.outboundRequestKey': { $type: 'string', $ne: '' } } });
issueSchema.index({ title: 'text', description: 'text', issueNumber: 'text', tags: 'text', category: 'text' });
issueSchema.index({ tenantId: 1, updatedAt: -1, status: 1 });
issueSchema.index({ tenantId: 1, category: 1, product: 1, priority: 1, updatedAt: -1 });
issueSchema.index({ tenantId: 1, customerVisibility: 1, status: 1, updatedAt: -1 });

const Issue = mongoose.model('Issue', issueSchema);

module.exports = {
  Issue,
  ISSUE_STATUSES,
  ISSUE_PRIORITIES,
  ISSUE_SOURCES,
  REPORTER_TYPES,
  TRIAGE_STATUSES,
  EXECUTION_MODES,
  EXECUTION_STATES,
  CUSTOMER_VISIBILITIES
};
