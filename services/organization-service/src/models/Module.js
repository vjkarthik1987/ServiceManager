import mongoose from 'mongoose';

const moduleSchema = new mongoose.Schema(
  {
    organizationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true, index: true },
    code: { type: String, required: true, trim: true, uppercase: true, minlength: 1, maxlength: 20 },
    name: { type: String, required: true, trim: true, minlength: 2, maxlength: 100 },
    description: { type: String, required: true, trim: true, minlength: 3, maxlength: 420 },
    status: { type: String, enum: ['active', 'inactive'], default: 'active' }
  },
  { timestamps: true }
);

moduleSchema.index({ organizationId: 1, productId: 1, code: 1 }, { unique: true });
moduleSchema.index({ organizationId: 1, productId: 1, name: 1 });

export const Module = mongoose.model('Module', moduleSchema);
