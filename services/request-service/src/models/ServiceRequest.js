import mongoose from 'mongoose';

const actorSnapshotSchema = new mongoose.Schema(
  {
    actorId: { type: String, trim: true, default: '' },
    name: { type: String, trim: true, maxlength: 140, default: '' },
    email: { type: String, trim: true, lowercase: true, maxlength: 180, default: '' },
    userType: { type: String, trim: true, maxlength: 40, default: '' },
    portal: { type: String, trim: true, maxlength: 40, default: '' }
  },
  { _id: false }
);

const namedRefSchema = new mongoose.Schema(
  {
    id: { type: String, trim: true, default: '' },
    name: { type: String, trim: true, maxlength: 180, default: '' },
    code: { type: String, trim: true, maxlength: 40, default: '' }
  },
  { _id: false }
);

const requestStatusSchema = new mongoose.Schema(
  {
    localId: { type: String, trim: true, maxlength: 40, default: '' },
    name: { type: String, trim: true, maxlength: 80, default: 'New' },
    customerLabel: { type: String, trim: true, maxlength: 80, default: 'New' },
    statusType: { type: String, trim: true, maxlength: 40, default: 'start' },
    isCustomerVisible: { type: Boolean, default: true },
    taskTemplates: {
      type: [
        {
          localId: { type: String, trim: true, maxlength: 60, default: '' },
          title: { type: String, trim: true, maxlength: 180, default: '' },
          description: { type: String, trim: true, maxlength: 800, default: '' },
          ownerSide: { type: String, trim: true, maxlength: 40, default: 'suntec' },
          queue: { type: String, trim: true, maxlength: 140, default: '' },
          isBlocking: { type: Boolean, default: false },
          visibility: { type: String, trim: true, maxlength: 40, default: 'internal_only' },
          displayOrder: { type: Number, default: 100 }
        }
      ],
      default: []
    }
  },
  { _id: false }
);

const workflowTransitionSchema = new mongoose.Schema(
  {
    fromStatusId: { type: String, trim: true, maxlength: 40, required: true },
    toStatusId: { type: String, trim: true, maxlength: 40, required: true }
  },
  { _id: false }
);

const workflowDefinitionSchema = new mongoose.Schema(
  {
    statuses: { type: [requestStatusSchema], default: [] },
    transitions: { type: [workflowTransitionSchema], default: [] }
  },
  { _id: false }
);

const supportLevelSchema = new mongoose.Schema(
  {
    localId: { type: String, trim: true, maxlength: 20, required: true },
    label: { type: String, trim: true, maxlength: 100, required: true },
    ownerSide: { type: String, enum: ['client', 'partner', 'suntec'], required: true },
    slaApplicable: { type: Boolean, default: false },
    displayOrder: { type: Number, default: 100 },
    workflowId: { type: String, trim: true, default: '' },
    workflowName: { type: String, trim: true, maxlength: 140, default: '' },
    workflow: { type: namedRefSchema, default: () => ({}) },
    workflowDefinition: { type: workflowDefinitionSchema, default: () => ({}) }
  },
  { _id: false }
);

const supportMovementRuleSchema = new mongoose.Schema(
  {
    localId: { type: String, trim: true, maxlength: 50, required: true },
    actionLabel: { type: String, trim: true, maxlength: 100, required: true },
    fromLevelId: { type: String, trim: true, maxlength: 20, required: true },
    toLevelId: { type: String, trim: true, maxlength: 20, required: true },
    movementType: { type: String, enum: ['sequential', 'parallel'], default: 'sequential' },
    toLevelIds: [{ type: String, trim: true, maxlength: 20 }],
    primaryLevelId: { type: String, trim: true, maxlength: 20, default: '' },
    targetStatusBehavior: { type: String, enum: ['keep', 'start'], default: 'start' },
    commentRequired: { type: Boolean, default: true },
    reasonRequired: { type: Boolean, default: true },
    displayOrder: { type: Number, default: 100 }
  },
  { _id: false }
);

const supportPathDefinitionSchema = new mongoose.Schema(
  {
    levels: { type: [supportLevelSchema], default: [] },
    movementRules: { type: [supportMovementRuleSchema], default: [] }
  },
  { _id: false }
);



const taskCommentSchema = new mongoose.Schema(
  {
    commentId: { type: String, trim: true, maxlength: 80, required: true },
    body: { type: String, trim: true, maxlength: 5000, required: true },
    visibility: { type: String, enum: ['client_visible', 'partner_visible', 'internal_only'], default: 'internal_only' },
    author: { type: actorSnapshotSchema, default: () => ({}) },
    attachments: {
      type: [{
        fileName: { type: String, trim: true, maxlength: 260, required: true },
        note: { type: String, trim: true, maxlength: 260, default: '' },
        fileUrl: { type: String, trim: true, maxlength: 1200, default: '' },
        publicId: { type: String, trim: true, maxlength: 300, default: '' },
        mimeType: { type: String, trim: true, maxlength: 120, default: '' },
        sizeBytes: { type: Number, default: null },
        uploadedBy: { type: actorSnapshotSchema, default: () => ({}) },
        createdAt: { type: Date, default: Date.now }
      }],
      default: []
    },
    createdAt: { type: Date, default: Date.now }
  },
  { _id: false }
);

const taskActivitySchema = new mongoose.Schema(
  {
    eventType: { type: String, trim: true, maxlength: 60, default: 'updated' },
    message: { type: String, trim: true, maxlength: 1000, default: '' },
    actor: { type: actorSnapshotSchema, default: () => ({}) },
    createdAt: { type: Date, default: Date.now }
  },
  { _id: false }
);


const requestTaskSchema = new mongoose.Schema(
  {
    localId: { type: String, trim: true, maxlength: 80, required: true },
    taskId: { type: String, trim: true, uppercase: true, maxlength: 120, default: '' },
    title: { type: String, required: true, trim: true, maxlength: 180 },
    description: { type: String, trim: true, maxlength: 1500, default: '' },
    ownerSide: { type: String, enum: ['client', 'partner', 'suntec', 'internal'], default: 'suntec' },
    queue: { type: String, trim: true, maxlength: 140, default: '' },
    priority: { type: String, enum: ['low', 'normal', 'high', 'critical'], default: 'normal' },
    assignedTo: { type: actorSnapshotSchema, default: () => ({}) },
    dueAt: { type: Date, default: null },
    startedAt: { type: Date, default: null },
    status: { type: String, enum: ['open', 'in_progress', 'blocked', 'done', 'cancelled'], default: 'open' },
    visibility: { type: String, enum: ['client_visible', 'partner_visible', 'internal_only'], default: 'internal_only' },
    isBlocking: { type: Boolean, default: false },
    sourceStatusId: { type: String, trim: true, maxlength: 60, default: '' },
    sourceStatusName: { type: String, trim: true, maxlength: 120, default: '' },
    sourceStageId: { type: String, trim: true, maxlength: 30, default: '' },
    createdByAutomation: { type: Boolean, default: true },
    createdAt: { type: Date, default: Date.now },
    completedAt: { type: Date, default: null },
    completionNote: { type: String, trim: true, maxlength: 1200, default: '' },
    completedBy: { type: actorSnapshotSchema, default: () => ({}) },
    comments: { type: [taskCommentSchema], default: [] },
    activity: { type: [taskActivitySchema], default: [] }
  },
  { _id: false }
);

const activeSupportStageSchema = new mongoose.Schema(
  {
    localId: { type: String, trim: true, maxlength: 20, required: true },
    label: { type: String, trim: true, maxlength: 120, default: '' },
    ownerSide: { type: String, enum: ['client', 'partner', 'suntec'], default: 'client' },
    isPrimary: { type: Boolean, default: false },
    assignedTo: { type: actorSnapshotSchema, default: () => ({}) },
    workflow: { type: namedRefSchema, default: () => ({}) },
    workflowDefinition: { type: workflowDefinitionSchema, default: () => ({}) },
    currentStatus: { type: requestStatusSchema, default: () => ({}) }
  },
  { _id: false }
);

const customFieldValueSchema = new mongoose.Schema(
  {
    fieldKey: { type: String, trim: true, uppercase: true, maxlength: 60, required: true },
    label: { type: String, trim: true, maxlength: 120, required: true },
    fieldType: { type: String, trim: true, maxlength: 40, default: 'short_text' },
    value: { type: mongoose.Schema.Types.Mixed, default: '' },
    displayValue: { type: String, trim: true, maxlength: 1200, default: '' }
  },
  { _id: false }
);

const slaRuleSnapshotSchema = new mongoose.Schema(
  {
    ruleBasis: { type: String, trim: true, maxlength: 30, default: 'severity' },
    severityId: { type: String, trim: true, default: '' },
    priorityId: { type: String, trim: true, default: '' },
    responseTimeValue: { type: Number, default: null },
    responseTimeUnit: { type: String, trim: true, default: 'hours' },
    resolutionTimeValue: { type: Number, default: null },
    resolutionTimeUnit: { type: String, trim: true, default: 'hours' },
    updateFrequencyValue: { type: Number, default: null },
    updateFrequencyUnit: { type: String, trim: true, default: 'daily' },
    clockType: { type: String, trim: true, default: 'working_hours' },
    notes: { type: String, trim: true, maxlength: 280, default: '' }
  },
  { _id: false }
);

const slaDefinitionSchema = new mongoose.Schema(
  {
    supportWindow: { type: String, trim: true, default: 'business_hours' },
    clockStartTrigger: { type: String, trim: true, default: 'severity_selected' },
    rules: { type: [slaRuleSnapshotSchema], default: [] },
    applicability: {
      applyOnlyWhenSeveritySelected: { type: Boolean, default: true },
      applicableEnvironmentIds: [{ type: String, trim: true }],
      applicableIssueLevelCodes: [{ type: String, trim: true, uppercase: true }]
    }
  },
  { _id: false }
);

const slaCalendarSchema = new mongoose.Schema(
  {
    timeZone: { type: String, trim: true, maxlength: 80, default: 'UTC' },
    workingDays: { type: [Number], default: () => [1, 2, 3, 4, 5] },
    dayStart: { type: String, trim: true, maxlength: 5, default: '09:00' },
    dayEnd: { type: String, trim: true, maxlength: 5, default: '17:00' },
    holidays: {
      type: [{
        _id: false,
        date: { type: String, trim: true, maxlength: 10 },
        name: { type: String, trim: true, maxlength: 120, default: '' }
      }],
      default: []
    }
  },
  { _id: false }
);

const slaTrackingSchema = new mongoose.Schema(
  {
    state: { type: String, enum: ['not_applicable', 'waiting', 'running', 'at_risk', 'breached', 'met', 'stopped'], default: 'not_applicable' },
    rag: { type: String, enum: ['grey', 'green', 'amber', 'red'], default: 'grey' },
    reason: { type: String, trim: true, maxlength: 280, default: '' },
    policyName: { type: String, trim: true, maxlength: 140, default: '' },
    ruleLabel: { type: String, trim: true, maxlength: 120, default: '' },
    basis: { type: String, trim: true, maxlength: 40, default: '' },
    startedAt: { type: Date, default: null },
    responseDueAt: { type: Date, default: null },
    resolutionDueAt: { type: Date, default: null },
    nextActionLabel: { type: String, trim: true, maxlength: 140, default: '' },
    nextDueAt: { type: Date, default: null },
    lastCalculatedAt: { type: Date, default: null }
  },
  { _id: false }
);


const slaMilestoneSchema = new mongoose.Schema(
  {
    state: {
      type: String,
      enum: ['not_started', 'waiting', 'running', 'at_risk', 'met', 'breached', 'not_applicable', 'cancelled', 'stopped'],
      default: 'not_started'
    },
    rag: { type: String, enum: ['grey', 'green', 'amber', 'red'], default: 'grey' },
    dueAt: { type: Date, default: null },
    actualAt: { type: Date, default: null },
    targetMinutes: { type: Number, default: null },
    completedBy: { type: actorSnapshotSchema, default: () => ({}) },
    completedByEventId: { type: String, trim: true, default: '' },
    label: { type: String, trim: true, maxlength: 100, default: '' },
    reason: { type: String, trim: true, maxlength: 280, default: '' }
  },
  { _id: false }
);

const slaMilestonesSchema = new mongoose.Schema(
  {
    response: { type: slaMilestoneSchema, default: () => ({ label: 'Response' }) },
    resolution: { type: slaMilestoneSchema, default: () => ({ label: 'Resolution' }) },
    update: { type: slaMilestoneSchema, default: () => ({ label: 'Next update' }) }
  },
  { _id: false }
);

const attachmentSchema = new mongoose.Schema(
  {
    fileName: { type: String, trim: true, maxlength: 260, required: true },
    note: { type: String, trim: true, maxlength: 260, default: '' },
    fileUrl: { type: String, trim: true, maxlength: 1200, default: '' },
    publicId: { type: String, trim: true, maxlength: 300, default: '' },
    mimeType: { type: String, trim: true, maxlength: 120, default: '' },
    sizeBytes: { type: Number, default: null },
    uploadedBy: { type: actorSnapshotSchema, default: () => ({}) },
    createdAt: { type: Date, default: Date.now }
  },
  { _id: false }
);

const requestCommentSchema = new mongoose.Schema(
  {
    commentId: { type: String, trim: true, default: '' },
    body: { type: String, trim: true, maxlength: 5000, required: true },
    visibility: {
      type: String,
      enum: ['client_visible', 'partner_visible', 'internal_only'],
      default: 'client_visible',
      index: true
    },
    author: { type: actorSnapshotSchema, default: () => ({}) },
    attachments: { type: [attachmentSchema], default: [] },
    countsAsResponse: { type: Boolean, default: false },
    countsAsUpdate: { type: Boolean, default: false },
    createdAt: { type: Date, default: Date.now }
  },
  { _id: false }
);

const timelineEventSchema = new mongoose.Schema(
  {
    eventType: { type: String, trim: true, maxlength: 60, default: 'created' },
    message: { type: String, trim: true, maxlength: 800, default: '' },
    visibility: { type: String, enum: ['', 'client_visible', 'partner_visible', 'internal_only'], default: '' },
    actor: { type: actorSnapshotSchema, default: () => ({}) },
    createdAt: { type: Date, default: Date.now }
  },
  { _id: false }
);

const serviceRequestSchema = new mongoose.Schema(
  {
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      index: true
    },
    requestNumber: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
      index: true
    },
    subject: {
      type: String,
      required: true,
      trim: true,
      minlength: 3,
      maxlength: 180
    },
    description: {
      type: String,
      required: true,
      trim: true,
      minlength: 10,
      maxlength: 5000
    },
    client: { type: namedRefSchema, required: true },
    level1Type: { type: namedRefSchema, required: true },
    level2Type: { type: namedRefSchema, required: true },
    level3Type: { type: namedRefSchema, default: () => ({}) },
    taxonomyVersion: { type: String, trim: true, maxlength: 20, default: '' },
    serviceModelKey: { type: String, trim: true, uppercase: true, maxlength: 80, default: '', index: true },
    workflow: { type: namedRefSchema, default: () => ({}) },
    workflowDefinition: { type: workflowDefinitionSchema, default: () => ({}) },
    supportPath: { type: namedRefSchema, default: () => ({}) },
    supportPathDefinition: { type: supportPathDefinitionSchema, default: () => ({}) },
    slaPolicy: { type: namedRefSchema, default: () => ({}) },
    slaDefinition: { type: slaDefinitionSchema, default: () => ({}) },
    slaCalendar: { type: slaCalendarSchema, default: () => ({}) },
    sla: { type: slaTrackingSchema, default: () => ({}) },
    slaMilestones: { type: slaMilestonesSchema, default: () => ({}) },
    customFieldValues: { type: [customFieldValueSchema], default: [] },
    currentStatus: { type: requestStatusSchema, default: () => ({}) },
    activeStages: { type: [activeSupportStageSchema], default: [] },
    tasks: { type: [requestTaskSchema], default: [] },
    taskSequence: { type: Number, default: 0 },
    severity: { type: namedRefSchema, default: () => ({}) },
    priority: { type: namedRefSchema, default: () => ({}) },
    product: { type: namedRefSchema, default: () => ({}) },
    module: { type: namedRefSchema, default: () => ({}) },
    modules: { type: [namedRefSchema], default: [] },
    region: { type: namedRefSchema, default: () => ({}) },
    environment: { type: namedRefSchema, default: () => ({}) },
    attachments: { type: [attachmentSchema], default: [] },

    // Creator/origin model. requester is retained for v7 compatibility and now means "created by".
    requester: { type: actorSnapshotSchema, required: true },
    raisedOnBehalfOf: { type: actorSnapshotSchema, default: () => ({}) },
    sourcePortal: {
      type: String,
      enum: ['admin', 'client', 'agent'],
      default: 'admin',
      index: true
    },
    source: {
      type: String,
      enum: ['client_portal', 'client_asked_agent', 'partner_observed', 'internal_observed', 'system_alert'],
      default: 'client_portal',
      index: true
    },
    visibilityScope: {
      type: String,
      enum: ['client_visible', 'partner_visible', 'internal_only'],
      default: 'client_visible',
      index: true
    },
    currentSupportLevel: {
      type: String,
      enum: ['L1', 'L2', 'L3'],
      default: 'L1',
      index: true
    },
    ownerSide: {
      type: String,
      enum: ['client', 'partner', 'suntec'],
      default: 'client',
      index: true
    },

    lifecycleState: {
      type: String,
      enum: ['open', 'returned', 'resolved', 'closed', 'cancelled'],
      default: 'open',
      index: true
    },
    timeline: { type: [timelineEventSchema], default: [] },
    comments: { type: [requestCommentSchema], default: [] }
  },
  { timestamps: true, optimisticConcurrency: true }
);

serviceRequestSchema.index({ organizationId: 1, requestNumber: 1 }, { unique: true });
serviceRequestSchema.index({ organizationId: 1, 'client.id': 1, createdAt: -1 });
serviceRequestSchema.index({ organizationId: 1, 'requester.actorId': 1, createdAt: -1 });
serviceRequestSchema.index({ organizationId: 1, 'level1Type.id': 1, 'level2Type.id': 1, 'level3Type.id': 1 });
serviceRequestSchema.index({ organizationId: 1, visibilityScope: 1, createdAt: -1 });
serviceRequestSchema.index({ organizationId: 1, currentSupportLevel: 1, ownerSide: 1, createdAt: -1 });
serviceRequestSchema.index({ organizationId: 1, 'sla.rag': 1, createdAt: -1 });
serviceRequestSchema.index({ organizationId: 1, 'tasks.taskId': 1 });

export const ServiceRequest = mongoose.model('ServiceRequest', serviceRequestSchema);
