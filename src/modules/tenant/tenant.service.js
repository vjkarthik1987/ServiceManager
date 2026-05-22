const mongoose = require('mongoose');
const { Tenant } = require('./tenant.model');

const DEFAULT_REQUEST_TAXONOMY = [
  { key: 'BUG', label: 'Issue', enabled: true, classificationRequired: false, classifications: ['Application Issue', 'Installation Issue', 'Access Issue', 'Data Issue', 'Performance Issue'] },
  { key: 'CR', label: 'Change Request', enabled: true, classificationRequired: false, classifications: ['Enhancement', 'Workflow Change', 'Regulatory Change', 'Report Change'] },
  { key: 'QUERY', label: 'Query', enabled: true, classificationRequired: false, classifications: ['How-to', 'Clarification', 'Configuration Help'] },
  { key: 'SERVICE_REQUEST', label: 'Service Request', enabled: false, classificationRequired: false, classifications: ['Access Request', 'Environment Refresh', 'Report Request', 'Deployment Support'] }
];

function slugify(value = '') {
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
}

async function ensureDefaultTenant() {
  const configuredSlug = process.env.TENANT_SLUG || process.env.TENANT_CODE || 'suntec';
  const slug = slugify(configuredSlug) || 'suntec';
  let tenant = await Tenant.findOne({ slug });
  if (!tenant) {
    tenant = await Tenant.create({
      _id: new mongoose.Types.ObjectId('64a000000000000000000001'),
      name: process.env.TENANT_NAME || 'SunTec',
      slug,
      status: 'active',
      branding: { accentColor: process.env.TENANT_ACCENT_COLOR || '#7C3AED' },
      issueConfig: {
        priorities: String(process.env.ISSUE_PRIORITY_OPTIONS || 'LOW,MEDIUM,HIGH,CRITICAL,BLOCKER').split(',').map((item) => String(item || '').trim()).filter(Boolean),
        categories: String(process.env.ISSUE_CATEGORY_OPTIONS || 'General,Access,Billing,Configuration,Data,Integration,Performance,Security,Support,Bug').split(',').map((item) => String(item || '').trim()).filter(Boolean),
        sources: String(process.env.ISSUE_SOURCE_OPTIONS || 'portal,email,api,phone,monitoring,bulk_upload,internal').split(',').map((item) => String(item || '').trim()).filter(Boolean),
        requestTaxonomy: DEFAULT_REQUEST_TAXONOMY,
        jiraIssueTypeByRequestType: {
          bug: String(process.env.JIRA_ISSUE_TYPE_BUG || 'Bug').trim() || 'Bug',
          cr: String(process.env.JIRA_ISSUE_TYPE_CR || 'Change Request').trim() || 'Change Request',
          query: String(process.env.JIRA_ISSUE_TYPE_QUERY || 'Task').trim() || 'Task',
          serviceRequest: String(process.env.JIRA_ISSUE_TYPE_SERVICE_REQUEST || 'Service Request').trim() || 'Service Request'
        }
      }
    });
  }
  return tenant;
}

async function findTenantBySlug(slug) {
  return Tenant.findOne({ slug: slugify(slug), status: 'active' });
}

module.exports = { slugify, ensureDefaultTenant, findTenantBySlug };
