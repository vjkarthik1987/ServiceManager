const mongoose = require('mongoose');

const tenantSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, trim: true, lowercase: true, unique: true, index: true },
    status: { type: String, enum: ['active', 'inactive'], default: 'active', index: true },
    branding: {
      accentColor: { type: String, default: '#7C3AED' },
      supportEmail: { type: String, default: '' }
    }
  },
  { timestamps: true }
);

const Tenant = mongoose.model('Tenant', tenantSchema);
module.exports = { Tenant };
