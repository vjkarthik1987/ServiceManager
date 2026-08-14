import mongoose from 'mongoose';


const customFieldSchema = new mongoose.Schema(
  {
    fieldKey: { type: String, required: true, trim: true, uppercase: true, maxlength: 60 },
    label: { type: String, required: true, trim: true, maxlength: 120 },
    fieldType: { type: String, enum: ['short_text', 'long_text', 'number', 'date', 'dropdown', 'multi_select', 'checkbox', 'url'], default: 'short_text' },
    required: { type: Boolean, default: false },
    helpText: { type: String, trim: true, maxlength: 260, default: '' },
    optionsText: { type: String, trim: true, maxlength: 1200, default: '' },
    displayOrder: { type: Number, default: 100 },
    status: { type: String, enum: ['active', 'inactive'], default: 'active' }
  },
  { _id: false }
);

const issueTypeSchema = new mongoose.Schema(
  {
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Organization',
      required: true,
      index: true
    },
    level: {
      type: Number,
      enum: [1, 2],
      required: true,
      index: true
    },
    parentTypeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'IssueType',
      default: null,
      index: true
    },
    name: {
      type: String,
      required: true,
      trim: true,
      minlength: 2,
      maxlength: 90
    },
    key: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
      maxlength: 80
    },
    description: {
      type: String,
      required: true,
      trim: true,
      minlength: 3,
      maxlength: 360
    },
    icon: {
      type: String,
      trim: true,
      maxlength: 8,
      default: '◌'
    },
    workflowId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Workflow',
      default: null,
      index: true
    },
    supportPathId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'SupportPath',
      default: null,
      index: true
    },

    fieldsConfig: {
      severity: { type: Boolean, default: true },
      priority: { type: Boolean, default: true },
      product: { type: Boolean, default: true },
      module: { type: Boolean, default: true },
      region: { type: Boolean, default: true },
      environment: { type: Boolean, default: true }
    },
    customFields: { type: [customFieldSchema], default: [] },
    displayOrder: {
      type: Number,
      default: 100
    },
    status: {
      type: String,
      enum: ['active', 'inactive'],
      default: 'active'
    }
  },
  { timestamps: true }
);

issueTypeSchema.index({ organizationId: 1, level: 1, parentTypeId: 1, key: 1 }, { unique: true });
issueTypeSchema.index({ organizationId: 1, level: 1, displayOrder: 1, name: 1 });

export const IssueType = mongoose.model('IssueType', issueTypeSchema);
