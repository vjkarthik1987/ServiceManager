const mongoose = require('mongoose');
const { Tenant } = require('./tenant.model');

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
      branding: { accentColor: process.env.TENANT_ACCENT_COLOR || '#7C3AED' }
    });
  }
  return tenant;
}

async function findTenantBySlug(slug) {
  return Tenant.findOne({ slug: slugify(slug), status: 'active' });
}

module.exports = { slugify, ensureDefaultTenant, findTenantBySlug };
