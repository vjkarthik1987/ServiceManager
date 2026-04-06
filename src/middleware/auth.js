
const { User } = require('../modules/users/user.model');
const { getMembershipsForUser, getAccessibleEntityIdsForUser } = require('../modules/memberships/membership.service');

function isApiRequest(req) {
  return req.path.startsWith('/api/') || req.originalUrl.startsWith('/api/');
}

function getLoginPath(req) {
  return req.basePath ? `${req.basePath}/login` : '/login';
}

function getDashboardPath(req) {
  return req.basePath ? `${req.basePath}/dashboard` : '/dashboard';
}

function deny(req, res, status, message, redirectTo = null) {
  const target = redirectTo || getDashboardPath(req);
  if (isApiRequest(req)) return res.status(status).json({ error: message });
  req.session.error = message;
  return res.redirect(target);
}

async function attachCurrentUser(req, res, next) {
  try {
    if (!req.session.userId) return next();
    const user = await User.findById(req.session.userId);
    if (!user || !user.isActive) return next();
    if (req.tenant && String(user.tenantId) !== String(req.tenant._id)) {
      req.currentUser = null;
      res.locals.currentUser = null;
      return next();
    }
    const memberships = await getMembershipsForUser({ tenantId: user.tenantId, userId: user._id, status: 'active' });
    req.currentUser = user;
    req.currentUser.memberships = memberships;
    return next();
  } catch (error) {
    return next(error);
  }
}

function requireAuth(req, res, next) {
  if (!req.currentUser) return deny(req, res, 401, 'Please login to continue.', getLoginPath(req));
  return next();
}

function requireRole(roles) {
  const allowedRoles = Array.isArray(roles) ? roles : Array.from(arguments);
  return (req, res, next) => {
    if (!req.currentUser) return deny(req, res, 401, 'Please login to continue.', getLoginPath(req));
    if (!allowedRoles.includes(req.currentUser.role)) return deny(req, res, 403, 'You do not have access to this page.');
    return next();
  };
}

function requireEntityAccess(entityIdResolver = null) {
  return async (req, res, next) => {
    try {
      if (!req.currentUser) return deny(req, res, 401, 'Please login to continue.', getLoginPath(req));
      if (req.currentUser.role === 'superadmin') return next();
      const rawEntityId = typeof entityIdResolver === 'function' ? entityIdResolver(req) : entityIdResolver || req.params.id || req.params.entityId || req.body.entityId || req.query.entityId;
      if (!rawEntityId) return deny(req, res, 400, 'Entity id is required.');
      const accessibleEntityIds = await getAccessibleEntityIdsForUser(req.currentUser);
      if (!accessibleEntityIds.includes(String(rawEntityId))) return deny(req, res, 403, 'You do not have access to this entity.');
      return next();
    } catch (error) { return next(error); }
  };
}

module.exports = { attachCurrentUser, requireAuth, requireRole, requireEntityAccess, getLoginPath, getDashboardPath };
