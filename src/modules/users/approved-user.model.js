const mongoose = require('mongoose');

const approvedUserSchema = new mongoose.Schema(
  {
    tenantId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, trim: true, lowercase: true },
    isActive: { type: Boolean, default: true },
    notes: { type: String, default: '', trim: true },
    createdByUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    linkedUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null }
  },
  { timestamps: true }
);

approvedUserSchema.index({ tenantId: 1, email: 1 }, { unique: true });

const ApprovedUser = mongoose.model('ApprovedUser', approvedUserSchema);

module.exports = { ApprovedUser };
