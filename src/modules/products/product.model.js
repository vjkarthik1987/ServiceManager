const mongoose = require('mongoose');

const productSchema = new mongoose.Schema({
  tenantId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  code: { type: String, required: true, trim: true, uppercase: true },
  name: { type: String, required: true, trim: true },
  description: { type: String, default: '', trim: true },
  isActive: { type: Boolean, default: true, index: true }
}, { timestamps: true });

productSchema.index({ tenantId: 1, code: 1 }, { unique: true });
module.exports = { Product: mongoose.model('Product', productSchema) };
