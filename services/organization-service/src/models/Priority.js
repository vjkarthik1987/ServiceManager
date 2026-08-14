import mongoose from 'mongoose';

const prioritySchema = new mongoose.Schema(
  {
    organizationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    code: { type: String, required: true, trim: true, uppercase: true, minlength: 1, maxlength: 12 },
    name: { type: String, required: true, trim: true, minlength: 2, maxlength: 80 },
    description: { type: String, required: true, trim: true, minlength: 3, maxlength: 420 },
    marker: { type: String, trim: true, maxlength: 24, default: '' },
    displayOrder: { type: Number, default: 100 },
    status: { type: String, enum: ['active', 'inactive'], default: 'active' }
  },
  { timestamps: true }
);

prioritySchema.index({ organizationId: 1, code: 1 }, { unique: true });
prioritySchema.index({ organizationId: 1, displayOrder: 1, code: 1 });

export const Priority = mongoose.model('Priority', prioritySchema);
