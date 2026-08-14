import mongoose from 'mongoose';

const workflowTaskTemplateSchema = new mongoose.Schema(
  {
    localId: { type: String, required: true, trim: true, maxlength: 60 },
    title: { type: String, required: true, trim: true, maxlength: 180 },
    description: { type: String, trim: true, maxlength: 800, default: '' },
    ownerSide: { type: String, enum: ['client', 'partner', 'suntec', 'internal'], default: 'suntec' },
    queue: { type: String, trim: true, maxlength: 140, default: '' },
    isBlocking: { type: Boolean, default: false },
    visibility: { type: String, enum: ['client_visible', 'partner_visible', 'internal_only'], default: 'internal_only' },
    displayOrder: { type: Number, default: 100 }
  },
  { _id: false }
);

const workflowStatusSchema = new mongoose.Schema(
  {
    localId: {
      type: String,
      required: true,
      trim: true,
      maxlength: 40
    },
    name: {
      type: String,
      required: true,
      trim: true,
      minlength: 2,
      maxlength: 80
    },
    description: {
      type: String,
      required: true,
      trim: true,
      minlength: 3,
      maxlength: 280
    },
    customerLabel: {
      type: String,
      required: true,
      trim: true,
      minlength: 2,
      maxlength: 80
    },
    statusType: {
      type: String,
      enum: ['start', 'normal', 'hold', 'waiting', 'resolved', 'final', 'cancelled'],
      default: 'normal'
    },
    isCustomerVisible: {
      type: Boolean,
      default: true
    },
    isActive: {
      type: Boolean,
      default: true
    },
    displayOrder: {
      type: Number,
      default: 100
    },
    taskTemplates: {
      type: [workflowTaskTemplateSchema],
      default: []
    }
  },
  { _id: false }
);

const workflowTransitionSchema = new mongoose.Schema(
  {
    fromStatusId: {
      type: String,
      required: true,
      trim: true
    },
    toStatusId: {
      type: String,
      required: true,
      trim: true
    }
  },
  { _id: false }
);

const workflowSchema = new mongoose.Schema(
  {
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Organization',
      required: true,
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
      maxlength: 420
    },
    statuses: {
      type: [workflowStatusSchema],
      default: []
    },
    transitions: {
      type: [workflowTransitionSchema],
      default: []
    },
    status: {
      type: String,
      enum: ['active', 'inactive'],
      default: 'active'
    }
  },
  { timestamps: true }
);

workflowSchema.index({ organizationId: 1, key: 1 }, { unique: true });
workflowSchema.index({ organizationId: 1, name: 1 });

export const Workflow = mongoose.model('Workflow', workflowSchema);
