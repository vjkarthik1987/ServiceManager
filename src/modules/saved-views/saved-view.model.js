
const mongoose = require('mongoose');
const savedViewSchema = new mongoose.Schema({
  tenantId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  name: { type: String, required: true, trim: true },
  scope: { type: String, enum: ['ISSUES'], default: 'ISSUES' },
  filters: { type: mongoose.Schema.Types.Mixed, default: {} },
  isDefault: { type: Boolean, default: false }
}, { timestamps: true });
savedViewSchema.index({ tenantId: 1, userId: 1, name: 1 }, { unique: true });
const SavedView = mongoose.model('SavedView', savedViewSchema);
module.exports = { SavedView };
