import mongoose from 'mongoose';

const clientOperationalRuleSchema = new mongoose.Schema(
  {
    localId: { type: String, required: true, trim: true, maxlength: 60 },
    level2TypeId: { type: mongoose.Schema.Types.ObjectId, ref: 'IssueType', required: true, index: true },
    supportPathId: { type: mongoose.Schema.Types.ObjectId, ref: 'SupportPath', required: true, index: true },
    severityIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Severity' }],
    environmentIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Environment' }],
    inheritToChildren: { type: Boolean, default: true },
    isActive: { type: Boolean, default: true }
  },
  { _id: false }
);


const clientFamilySlaAssignmentSchema = new mongoose.Schema(
  {
    localId: { type: String, required: true, trim: true, maxlength: 80 },
    level1TypeId: { type: mongoose.Schema.Types.ObjectId, ref: 'IssueType', required: true, index: true },
    slaPolicyId: { type: mongoose.Schema.Types.ObjectId, ref: 'SlaPolicy', required: true, index: true },
    inheritToChildren: { type: Boolean, default: true },
    isActive: { type: Boolean, default: true }
  },
  { _id: false }
);

const clientSchema = new mongoose.Schema(
  {
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Organization',
      required: true,
      index: true
    },
    parentClientId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Client',
      default: null,
      index: true
    },
    name: {
      type: String,
      required: true,
      trim: true,
      minlength: 2,
      maxlength: 140
    },
    shortCode: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
      minlength: 6,
      maxlength: 6,
      match: /^[A-Z]{6}$/
    },
    primaryDomain: {
      type: String,
      trim: true,
      lowercase: true,
      maxlength: 180,
      default: ''
    },
    description: {
      type: String,
      trim: true,
      maxlength: 520,
      default: ''
    },
    notes: {
      type: String,
      trim: true,
      maxlength: 360,
      default: ''
    },
    regionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Region',
      default: null,
      index: true
    },
    subregionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Subregion',
      default: null,
      index: true
    },
    timezone: {
      type: String,
      trim: true,
      maxlength: 80,
      default: ''
    },
    businessCalendarMode: {
      type: String,
      enum: ['inherit', 'custom'],
      default: 'custom'
    },
    businessCalendar: {
      timezone: { type: String, trim: true, maxlength: 80, default: '' },
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
    status: {
      type: String,
      enum: ['active', 'inactive'],
      default: 'active'
    },
    depth: {
      type: Number,
      default: 0,
      min: 0,
      index: true
    },
    path: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Client'
      }
    ],
    issueTypeMode: {
      type: String,
      enum: ['inherit', 'custom'],
      default: 'custom'
    },
    // v23.1: clients are enabled at Family (taxonomy level 1).
    enabledFamilyIds: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'IssueType'
      }
    ],
    // Retained as storage-only legacy data; v23.1 screens and request intake use enabledFamilyIds.
    enabledLevel1IssueTypeIds: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'IssueType'
      }
    ],
    slaMode: {
      type: String,
      enum: ['inherit', 'custom'],
      default: 'custom'
    },
    defaultSlaPolicyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'SlaPolicy',
      default: null,
      index: true
    },

    familySlaAssignments: {
      type: [clientFamilySlaAssignmentSchema],
      default: []
    },
    productModuleMode: {
      type: String,
      enum: ['inherit', 'custom'],
      default: 'custom'
    },
    enabledProductIds: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Product'
      }
    ],
    enabledModuleIds: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Module'
      }
    ],
    enabledEnvironmentIds: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Environment'
      }
    ],
    operationalRules: {
      type: [clientOperationalRuleSchema],
      default: []
    }
  },
  { timestamps: true }
);

clientSchema.index({ organizationId: 1, shortCode: 1 }, { unique: true });
clientSchema.index({ organizationId: 1, parentClientId: 1, name: 1 });
clientSchema.index({ organizationId: 1, path: 1 });

export const Client = mongoose.model('Client', clientSchema);
