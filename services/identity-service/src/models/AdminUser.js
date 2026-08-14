import mongoose from 'mongoose';

const adminUserSchema = new mongoose.Schema(
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
    role: {
      type: String,
      enum: ['owner', 'admin'],
      default: 'owner'
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
      enum: ['pending', 'active', 'inactive'],
      default: 'active'
    },
    activationTokenHash: { type: String, default: '', index: true },
    activationTokenExpiresAt: { type: Date, default: null },
    activatedAt: { type: Date, default: null },
    resetTokenHash: { type: String, default: '', index: true },
    resetTokenExpiresAt: { type: Date, default: null },
    pendingEmail: { type: String, trim: true, lowercase: true, maxlength: 180, default: '' },
    emailChangeTokenHash: { type: String, default: '', index: true },
    emailChangeTokenExpiresAt: { type: Date, default: null }
  },
  {
    timestamps: true
  }
);

adminUserSchema.index({ organizationId: 1, email: 1 }, { unique: true });
adminUserSchema.index({ createdAt: -1 });

export const AdminUser = mongoose.model('AdminUser', adminUserSchema);
