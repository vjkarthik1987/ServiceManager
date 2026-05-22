const mongoose = require('mongoose');

const userSchema = new mongoose.Schema(
  {
    tenantId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, trim: true, lowercase: true },
    passwordHash: { type: String, required: true },
    role: {
      type: String,
      enum: ['superadmin', 'agent', 'agent_manager', 'agent_user', 'client', 'engagement_manager', 'regional_head', 'support_head'],
      required: true,
      index: true
    },
    isActive: { type: Boolean, default: true },
    regions: { type: [String], default: [] },
    resetPasswordTokenHash: { type: String, default: '' },
    resetPasswordExpiresAt: { type: Date, default: null }
  },
  { timestamps: true }
);

userSchema.index({ tenantId: 1, email: 1 }, { unique: true });

const User = mongoose.model('User', userSchema);

module.exports = { User };
