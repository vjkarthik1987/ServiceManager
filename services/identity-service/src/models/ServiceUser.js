import mongoose from 'mongoose';

const assignmentSchema = new mongoose.Schema(
  {
    clientId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true
    },
    role: {
      type: String,
      enum: ['clientUser', 'partnerUser', 'agentUser', 'agentManager', 'engagementManager'],
      required: true
    },
    includeChildren: {
      type: Boolean,
      default: false
    },
    supportLevels: {
      type: [{ type: String, enum: ['L1', 'L2', 'L3'] }],
      default: []
    }
  },
  { _id: true }
);

// Kept for compatibility with v6-v9 records. New authorization uses assignments.
const legacyClientScopeSchema = new mongoose.Schema(
  {
    clientId: { type: mongoose.Schema.Types.ObjectId, required: true },
    includeChildren: { type: Boolean, default: false }
  },
  { _id: false }
);

const serviceUserSchema = new mongoose.Schema(
  {
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      index: true
    },
    name: {
      type: String,
      required: true,
      trim: true,
      minlength: 2,
      maxlength: 120
    },
    email: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      maxlength: 180,
      match: /.+@.+\..+/
    },
    assignments: {
      type: [assignmentSchema],
      default: []
    },
    // Legacy fields allow existing databases to continue without migration scripts.
    userType: {
      type: String,
      enum: ['agentUser', 'agentManager', 'client', 'engagementManager'],
      default: undefined
    },
    clientScopes: {
      type: [legacyClientScopeSchema],
      default: []
    },
    passwordHash: {
      type: String,
      required: true
    },
    mustChangePassword: {
      type: Boolean,
      default: true
    },
    status: {
      type: String,
      enum: ['active', 'inactive'],
      default: 'active'
    },
    resetTokenHash: { type: String, default: '', index: true },
    resetTokenExpiresAt: { type: Date, default: null },
    pendingEmail: { type: String, trim: true, lowercase: true, maxlength: 180, default: '' },
    emailChangeTokenHash: { type: String, default: '', index: true },
    emailChangeTokenExpiresAt: { type: Date, default: null }
  },
  { timestamps: true }
);

serviceUserSchema.index({ organizationId: 1, email: 1 }, { unique: true });
serviceUserSchema.index({ email: 1, status: 1 });
serviceUserSchema.index({ organizationId: 1, 'assignments.clientId': 1, status: 1 });
serviceUserSchema.index({ organizationId: 1, 'assignments.role': 1, status: 1 });

export const ServiceUser = mongoose.model('ServiceUser', serviceUserSchema);
