const mongoose = require('mongoose');

const tenantSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, trim: true, lowercase: true, unique: true, index: true },
    status: { type: String, enum: ['active', 'inactive'], default: 'active', index: true },
    branding: {
      accentColor: { type: String, default: '#7C3AED' },
      supportEmail: { type: String, default: '' }
    },
    notificationConfig: {
      userProvisioningTrackingEmail: { type: String, default: '' }
    },
    issueConfig: {
      priorities: { type: [String], default: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL', 'BLOCKER'] },
      categories: { type: [String], default: ['General', 'Access', 'Billing', 'Configuration', 'Data', 'Integration', 'Performance', 'Security', 'Support', 'Bug'] },
      sources: { type: [String], default: ['portal', 'email', 'api', 'phone', 'monitoring', 'bulk_upload', 'internal'] },
      regions: { type: [String], default: ['India', 'UAE'] },
      requestTaxonomy: { type: [mongoose.Schema.Types.Mixed], default: [] },
      jiraIssueTypeByRequestType: {
        bug: { type: String, default: 'Bug' },
        cr: { type: String, default: 'Change Request' },
        query: { type: String, default: 'Task' },
        serviceRequest: { type: String, default: 'Service Request' }
      }
    }
  },
  { timestamps: true }
);

const Tenant = mongoose.model('Tenant', tenantSchema);
module.exports = { Tenant };
