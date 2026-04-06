const mongoose = require('mongoose');

const MATCH_ANY = 'ANY';
const PRIORITY_OPTIONS = ['ANY', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL', 'BLOCKER'];
const EXECUTION_OPTIONS = ['ANY', 'NATIVE', 'JIRA'];
const AGREEMENT_TYPES = ['SLA', 'OLA', 'CUSTOM'];
const SCOPE_LEVELS = ['GLOBAL', 'CLIENT', 'SUBCLIENT'];
const SCOPE_BEHAVIORS = ['DIRECT', 'INHERIT_ONLY', 'INHERIT_AND_OVERRIDE'];
const TIME_UNITS = ['MINUTES', 'HOURS', 'DAYS'];
const METRIC_TYPES = ['FIRST_RESPONSE', 'ACKNOWLEDGEMENT', 'WORKAROUND', 'RESOLUTION', 'UPDATE_FREQUENCY', 'CLOSURE_CONFIRMATION'];

const metricTargetSchema = new mongoose.Schema({
  metricType: { type: String, enum: METRIC_TYPES, required: true },
  value: { type: Number, required: true, min: 0 },
  unit: { type: String, enum: TIME_UNITS, required: true, default: 'MINUTES' },
  normalizedMinutes: { type: Number, required: true, min: 0 }
}, { _id: false });

const severityLevelSchema = new mongoose.Schema({
  severity: { type: String, enum: PRIORITY_OPTIONS.filter((item) => item !== 'ANY'), required: true },
  displayName: { type: String, default: '' },
  isEnabled: { type: Boolean, default: true },
  metricTargets: { type: [metricTargetSchema], default: [] },
  escalationRecipients: { type: [String], default: [] },
  escalationNote: { type: String, default: '', trim: true }
}, { _id: false });

const slaPolicySchema = new mongoose.Schema({
  tenantId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  name: { type: String, required: true, trim: true },
  description: { type: String, default: '', trim: true },
  agreementType: { type: String, enum: AGREEMENT_TYPES, default: 'SLA', index: true },
  scopeLevel: { type: String, enum: SCOPE_LEVELS, default: 'GLOBAL', index: true },
  scopeBehavior: { type: String, enum: SCOPE_BEHAVIORS, default: 'DIRECT' },
  entityId: { type: mongoose.Schema.Types.ObjectId, ref: 'Entity', default: null, index: true },
  inheritsFromParent: { type: Boolean, default: true },
  category: { type: String, default: MATCH_ANY, trim: true },
  priority: { type: String, enum: PRIORITY_OPTIONS, default: MATCH_ANY, index: true },
  executionMode: { type: String, enum: EXECUTION_OPTIONS, default: MATCH_ANY, index: true },
  supportGroupId: { type: mongoose.Schema.Types.ObjectId, ref: 'SupportGroup', default: null },
  responseTargetMinutes: { type: Number, required: true, min: 0, default: 60 },
  resolutionTargetMinutes: { type: Number, required: true, min: 0, default: 480 },
  warningThresholdPercent: { type: Number, default: 80, min: 1, max: 99 },
  isActive: { type: Boolean, default: true, index: true },
  rank: { type: Number, default: 100, index: true },
  appliesToDescendants: { type: Boolean, default: true },
  businessHoursMode: { type: String, enum: ['TWENTY_FOUR_SEVEN', 'BUSINESS_HOURS'], default: 'TWENTY_FOUR_SEVEN' },
  businessHoursStart: { type: String, default: '09:00' },
  businessHoursEnd: { type: String, default: '18:00' },
  holidayCalendar: { type: [String], default: [] },
  stageTargets: { type: [{ stage: String, targetMinutes: Number }], default: [] },
  escalationNote: { type: String, default: '', trim: true },
  escalationRecipients: { type: [String], default: [] },
  severityLevels: { type: [severityLevelSchema], default: [] }
}, { timestamps: true });

slaPolicySchema.index({ tenantId: 1, isActive: 1, agreementType: 1, scopeLevel: 1, entityId: 1, rank: 1, priority: 1, executionMode: 1 });
slaPolicySchema.index({ tenantId: 1, name: 1 }, { unique: true });

const SlaPolicy = mongoose.model('SlaPolicy', slaPolicySchema);
module.exports = { SlaPolicy, MATCH_ANY, PRIORITY_OPTIONS, EXECUTION_OPTIONS, AGREEMENT_TYPES, SCOPE_LEVELS, SCOPE_BEHAVIORS, TIME_UNITS, METRIC_TYPES };
