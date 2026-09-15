import mongoose from 'mongoose';

const environmentSchema = new mongoose.Schema(
  {
    organizationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    code: { type: String, required: true, trim: true, uppercase: true, minlength: 2, maxlength: 20 },
    name: { type: String, required: true, trim: true, minlength: 2, maxlength: 100 },
    description: { type: String, required: true, trim: true, minlength: 2, maxlength: 420 },
    environmentType: { type: String, enum: ['non_production', 'production_like', 'production', 'dr'], default: 'non_production' },
    slaApplicableByDefault: { type: Boolean, default: false },
    displayOrder: { type: Number, default: 100 },
    status: { type: String, enum: ['active', 'inactive'], default: 'active' }
  },
  { timestamps: true }
);

environmentSchema.index({ organizationId: 1, code: 1 }, { unique: true });
environmentSchema.index({ organizationId: 1, displayOrder: 1, code: 1 });

export const Environment = mongoose.model('Environment', environmentSchema);
