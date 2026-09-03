import mongoose from 'mongoose';

const supportLevelSchema = new mongoose.Schema(
  {
    localId: { type: String, required: true, trim: true, maxlength: 20 },
    label: { type: String, required: true, trim: true, maxlength: 100 },
    ownerSide: { type: String, enum: ['client', 'partner', 'suntec'], required: true },
    slaApplicable: { type: Boolean, default: false },
    displayOrder: { type: Number, default: 100 },
    workflowId: { type: mongoose.Schema.Types.ObjectId, ref: 'Workflow', default: null, index: true },
    workflowName: { type: String, trim: true, maxlength: 140, default: '' }
  },
  { _id: false }
);

const movementRuleSchema = new mongoose.Schema(
  {
    localId: { type: String, required: true, trim: true, maxlength: 50 },
    actionLabel: { type: String, required: true, trim: true, maxlength: 100 },
    fromLevelId: { type: String, required: true, trim: true, maxlength: 20 },
    toLevelId: { type: String, required: true, trim: true, maxlength: 20 },
    movementType: { type: String, enum: ['sequential', 'parallel'], default: 'sequential' },
    targetStatusBehavior: { type: String, enum: ['keep', 'start'], default: 'start' },
    toLevelIds: [{ type: String, trim: true, maxlength: 20 }],
    primaryLevelId: { type: String, trim: true, maxlength: 20, default: '' },
    commentRequired: { type: Boolean, default: true },
    reasonRequired: { type: Boolean, default: true },
    displayOrder: { type: Number, default: 100 }
  },
  { _id: false }
);

const supportPathSchema = new mongoose.Schema(
  {
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Organization',
      required: true,
      index: true
    },
    name: { type: String, required: true, trim: true, minlength: 2, maxlength: 100 },
    key: { type: String, required: true, trim: true, uppercase: true, maxlength: 80 },
    description: { type: String, required: true, trim: true, minlength: 3, maxlength: 420 },
    levels: { type: [supportLevelSchema], default: [] },
    movementRules: { type: [movementRuleSchema], default: [] },
    status: { type: String, enum: ['active', 'inactive'], default: 'active' }
  },
  { timestamps: true }
);

supportPathSchema.index({ organizationId: 1, key: 1 }, { unique: true });
supportPathSchema.index({ organizationId: 1, name: 1 });

export const SupportPath = mongoose.model('SupportPath', supportPathSchema);
