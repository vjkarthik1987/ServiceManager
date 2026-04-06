const mongoose = require('mongoose');

const membershipSchema = new mongoose.Schema(
  {
    tenantId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    entityId: { type: mongoose.Schema.Types.ObjectId, ref: 'Entity', required: true, index: true },
    roleWithinEntity: { type: String, default: '' },
    isPrimary: { type: Boolean, default: false },
    status: { type: String, enum: ['active', 'inactive'], default: 'active', index: true }
  },
  { timestamps: true }
);

membershipSchema.index({ tenantId: 1, userId: 1, entityId: 1 }, { unique: true });
membershipSchema.index(
  { tenantId: 1, userId: 1, isPrimary: 1 },
  {
    unique: true,
    partialFilterExpression: { isPrimary: true }
  }
);

const UserEntityMembership = mongoose.model('UserEntityMembership', membershipSchema);

module.exports = { UserEntityMembership };
