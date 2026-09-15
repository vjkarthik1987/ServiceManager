import mongoose from 'mongoose';

const organizationSchema = new mongoose.Schema(
  {
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
      minlength: 2,
      maxlength: 12,
      match: /^[A-Z0-9]+$/
    },
    primaryDomain: {
      type: String,
      trim: true,
      lowercase: true,
      maxlength: 180
    },
    workspaceSlug: {
      type: String,
      trim: true,
      lowercase: true,
      minlength: 2,
      maxlength: 48,
      match: /^[a-z0-9-]+$/
    },
    status: {
      type: String,
      enum: ['pending', 'active', 'inactive'],
      default: 'active'
    },
    createdBy: {
      type: String,
      trim: true,
      lowercase: true
    }
  },
  {
    timestamps: true
  }
);

organizationSchema.index({ shortCode: 1 }, { unique: true });
organizationSchema.index({ workspaceSlug: 1 }, { unique: true, sparse: true });
organizationSchema.index({ createdAt: -1 });

export const Organization = mongoose.model('Organization', organizationSchema);
