import mongoose from 'mongoose';

const slaRuleSchema = new mongoose.Schema(
  {
    ruleBasis: { type: String, enum: ['severity', 'priority'], required: true, default: 'severity' },
    severityId: { type: mongoose.Schema.Types.ObjectId, ref: 'Severity', default: null },
    priorityId: { type: mongoose.Schema.Types.ObjectId, ref: 'Priority', default: null },
    responseTimeValue: { type: Number, default: null, min: 0 },
    responseTimeUnit: { type: String, enum: ['minutes', 'hours', 'business_hours', 'days', 'business_days', 'none'], default: 'hours' },
    resolutionTimeValue: { type: Number, default: null, min: 0 },
    resolutionTimeUnit: { type: String, enum: ['minutes', 'hours', 'business_hours', 'days', 'business_days', 'none'], default: 'hours' },
    updateFrequencyValue: { type: Number, default: null, min: 0 },
    updateFrequencyUnit: { type: String, enum: ['minutes', 'hours', 'business_hours', 'days', 'business_days', 'daily', 'twice_daily', 'periodic', 'none'], default: 'daily' },
    clockType: { type: String, enum: ['calendar', 'working_hours'], default: 'working_hours' },
    notes: { type: String, trim: true, maxlength: 280, default: '' }
  },
  { _id: false }
);

const slaPolicySchema = new mongoose.Schema(
  {
    organizationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    name: { type: String, required: true, trim: true, minlength: 2, maxlength: 120 },
    key: { type: String, required: true, trim: true, uppercase: true, maxlength: 100 },
    description: { type: String, required: true, trim: true, minlength: 3, maxlength: 520 },
    supportWindow: { type: String, enum: ['business_hours', '24x7', 'mixed'], default: 'business_hours' },
    clockStartTrigger: { type: String, enum: ['severity_selected', 'priority_selected', 'ticket_created'], default: 'severity_selected' },
    rules: { type: [slaRuleSchema], default: [] },
    applicability: {
      applyOnlyWhenSeveritySelected: { type: Boolean, default: true },
      applicableEnvironmentIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Environment' }],
      applicableIssueLevelCodes: [{ type: String, trim: true, uppercase: true }]
    },
    status: { type: String, enum: ['active', 'inactive'], default: 'active' }
  },
  { timestamps: true }
);

slaPolicySchema.index({ organizationId: 1, key: 1 }, { unique: true });
slaPolicySchema.index({ organizationId: 1, name: 1 });

export const SlaPolicy = mongoose.model('SlaPolicy', slaPolicySchema);
