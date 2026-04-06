const { ensureDefaultTenant, findTenantBySlug, slugify } = require('../modules/tenant/tenant.service');

const RESERVED_ROOT_SEGMENTS = new Set(['login', 'signup', 'logout', 'health', 'api', 'favicon.ico']);

function getSlugFromPath(req) {
  const parts = (req.path || req.originalUrl || '')
    .split('?')[0]
    .split('/')
    .filter(Boolean);

  if (!parts.length) return null;
  if (parts[0] === 'api' && parts[1] === 'v1' && parts[2]) return parts[2];
  if (RESERVED_ROOT_SEGMENTS.has(parts[0])) return null;
  return parts[0] || null;
}

async function attachTenant(req, res, next) {
  try {
    const slugFromRoute = req.params.tenantSlug || req.query.tenant || null;
    const slugFromPath = getSlugFromPath(req);
    const slugFromSession = req.session && req.session.tenantSlug ? req.session.tenantSlug : null;
    const requestedSlug = slugify(slugFromRoute || slugFromPath || slugFromSession || process.env.TENANT_SLUG || process.env.TENANT_CODE || 'suntec');

    const tenant = requestedSlug ? await findTenantBySlug(requestedSlug) : null;
    if ((slugFromRoute || slugFromPath) && !tenant) {
      const error = new Error('Workspace not found.');
      error.status = 404;
      throw error;
    }
    req.tenant = tenant || (await ensureDefaultTenant());
    req.tenantSlug = req.tenant.slug;
    req.basePath = `/${req.tenant.slug}`;
    req.apiBasePath = `/api/v1/${req.tenant.slug}`;
    return next();
  } catch (error) {
    return next(error);
  }
}

function requireTenantMatch(req, res, next) {
  if (!req.currentUser) return next();
  if (!req.session.tenantId || !req.params.tenantSlug) return next();
  if (String(req.session.tenantId) !== String(req.tenant._id)) {
    req.session.error = 'You do not have access to this workspace.';
    return res.redirect(`/${req.session.tenantSlug || req.tenant.slug}/dashboard`);
  }
  return next();
}

module.exports = { attachTenant, requireTenantMatch };
