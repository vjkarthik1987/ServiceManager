const mongoose = require('mongoose');

const supportGroupSchema = new mongoose.Schema(
  {
    tenantId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
    name: { type: String, required: true, trim: true },
    code: { type: String, required: true, trim: true, uppercase: true },
    description: { type: String, default: '', trim: true },
    defaultAssigneeUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    isActive: { type: Boolean, default: true, index: true }
  },
  { timestamps: true }
);

supportGroupSchema.index({ tenantId: 1, name: 1 }, { unique: true });
supportGroupSchema.index({ tenantId: 1, code: 1 }, { unique: true });

const SupportGroup = mongoose.model('SupportGroup', supportGroupSchema);
module.exports = { SupportGroup };
