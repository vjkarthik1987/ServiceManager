import mongoose from 'mongoose';

const regionSchema = new mongoose.Schema(
  {
    organizationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    code: { type: String, required: true, trim: true, uppercase: true, minlength: 2, maxlength: 20 },
    name: { type: String, required: true, trim: true, minlength: 2, maxlength: 100 },
    description: { type: String, required: true, trim: true, minlength: 2, maxlength: 420 },
    timezone: { type: String, required: true, trim: true, minlength: 3, maxlength: 80 },
    status: { type: String, enum: ['active', 'inactive'], default: 'active' }
  },
  { timestamps: true }
);

regionSchema.index({ organizationId: 1, code: 1 }, { unique: true });
regionSchema.index({ organizationId: 1, name: 1 });

export const Region = mongoose.model('Region', regionSchema);
