const mongoose = require('mongoose');

const statusMappingSchema = new mongoose.Schema(
  {
    tenantId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
    jiraProjectKey: { type: String, default: 'DEFAULT', trim: true, uppercase: true, index: true },
    internalStatus: { type: String, required: true, trim: true, uppercase: true, index: true },
    customerLabel: { type: String, required: true, trim: true },
    badgeTone: { type: String, enum: ['subtle', 'brand-soft', 'success-soft', 'warning-soft'], default: 'subtle' },
    isActive: { type: Boolean, default: true, index: true },
    rank: { type: Number, default: 100, index: true }
  },
  { timestamps: true }
);

statusMappingSchema.index({ tenantId: 1, jiraProjectKey: 1, internalStatus: 1 }, { unique: true });

const StatusMapping = mongoose.model('StatusMapping', statusMappingSchema);
module.exports = { StatusMapping };
