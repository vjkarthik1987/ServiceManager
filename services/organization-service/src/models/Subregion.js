import mongoose from 'mongoose';

const subregionSchema = new mongoose.Schema(
  {
    organizationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    regionId: { type: mongoose.Schema.Types.ObjectId, ref: 'Region', required: true, index: true },
    code: { type: String, required: true, trim: true, uppercase: true, minlength: 2, maxlength: 20 },
    name: { type: String, required: true, trim: true, minlength: 2, maxlength: 100 },
    description: { type: String, trim: true, maxlength: 420, default: '' },
    timezone: { type: String, trim: true, maxlength: 80, default: '' },
    status: { type: String, enum: ['active', 'inactive'], default: 'active' }
  },
  { timestamps: true }
);

subregionSchema.index({ organizationId: 1, regionId: 1, code: 1 }, { unique: true });
subregionSchema.index({ organizationId: 1, regionId: 1, name: 1 });

export const Subregion = mongoose.model('Subregion', subregionSchema);
