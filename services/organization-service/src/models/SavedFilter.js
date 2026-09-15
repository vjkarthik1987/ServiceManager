import mongoose from 'mongoose';

const savedFilterSchema = new mongoose.Schema(
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
    target: {
      type: String,
      enum: ['requests', 'clients'],
      required: true,
      index: true
    },
    query: {
      type: String,
      trim: true,
      maxlength: 1000,
      default: ''
    },
    createdBy: {
      type: String,
      trim: true,
      maxlength: 180,
      default: ''
    },
    createdByRole: {
      type: String,
      trim: true,
      maxlength: 80,
      default: ''
    },
    visibilityScope: {
      type: String,
      enum: ['private', 'team', 'tenant'],
      default: 'private',
      index: true
    },
    status: {
      type: String,
      enum: ['active', 'inactive'],
      default: 'active',
      index: true
    }
  },
  { timestamps: true }
);

savedFilterSchema.index({ organizationId: 1, name: 1, target: 1 }, { unique: true });

export const SavedFilter = mongoose.model('SavedFilter', savedFilterSchema);
