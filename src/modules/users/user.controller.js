const { Entity } = require('../entities/entity.model');
const { logAudit } = require('../audit/audit.service');
const { getPagination, buildPager, buildQueryString } = require('../../utils/pagination');
const { rowsToExcelXml, sendExcelXml } = require('../../utils/export');
const { createUserForTenant, listUsersForTenant, updateUserForTenant, changePasswordForUser } = require('./user.service');
const { getMembershipsForUser, getMembershipsForEntity, validateEntityInTenant, validateUserInTenant, createMembershipsForNewUser } = require('../memberships/membership.service');
const { getAccessibleEntityIdsForUser, userHasEntityAccess } = require('../../utils/access');

function mapMemberships(memberships) {
  return memberships.map((membership) => ({
    id: membership._id.toString(),
    entityId: membership.entityId?._id?.toString() || membership.entityId?.toString(),
    entityName: membership.entityId?.name || null,
    entityPath: membership.entityId?.path || null,
    isPrimary: membership.isPrimary,
    status: membership.status
  }));
}

async function listUsers(req, res, next) {
  try {
    let users = await listUsersForTenant(req.tenant._id);
    if (req.currentUser.role === 'client') {
      const allowed = await getAccessibleEntityIdsForUser(req.currentUser);
      users = users.filter(({ user, memberships }) => user.role === 'client' && memberships.some((m) => allowed.includes(String(m.entityId?._id || m.entityId))));
    }
    const filters = { q: req.query.q || '', role: req.query.role || '' };
    if (filters.q) {
      const q = filters.q.toLowerCase();
      users = users.filter(({ user, memberships }) => [user.name, user.email, user.role, memberships.map((m) => m.entityId?.path || '').join(' ')].join(' ').toLowerCase().includes(q));
    }
    if (filters.role) users = users.filter((item) => item.user.role === filters.role);
    const { page, pageSize, skip } = getPagination(req.query, 10);
    const totalItems = users.length;
    const pager = buildPager({ totalItems, page, pageSize });
    return res.render('users/list', { title: 'Users', users: users.slice(skip, skip + pageSize), filters, pager, buildQueryString });
  } catch (error) { return next(error); }
}

async function showCreateUser(req, res, next) {
  try {
    let entities = await Entity.find({ tenantId: req.tenant._id, isActive: true }).sort({ path: 1 });
    let role = req.query.role || 'client';
    if (req.currentUser.role === 'client') {
      const allowed = await getAccessibleEntityIdsForUser(req.currentUser);
      entities = entities.filter((entity) => allowed.includes(String(entity._id)));
      role = 'client';
    }
    return res.render('users/new', { title: 'Create User', entities, defaults: { role } });
  } catch (error) { return next(error); }
}

async function createUser(req, res, next) {
  try {
    let { name, email, role, entityId } = req.body;
    const password = 'password';
    const entityIds = Array.isArray(req.body.entityIds) ? req.body.entityIds : req.body.entityIds ? [req.body.entityIds] : [];
    if (!entityId && entityIds.length) entityId = entityIds[0];
    if (!entityId && entityIds.length) entityId = entityIds[0];
    if (!['superadmin', 'client'].includes(req.currentUser.role)) {
      req.session.error = 'You do not have access to create users.';
      return res.redirect(`${req.basePath}/users`);
    }
    if (req.currentUser.role === 'client') {
      role = 'client';
      for (const selectedEntityId of entityIds.length ? entityIds : entityId ? [entityId] : []) {
        if (!(await userHasEntityAccess(req.currentUser, selectedEntityId))) {
          req.session.error = 'You do not have access to one or more selected entities.';
          return res.redirect(`${req.basePath}/users/new?role=client`);
        }
      }
    }
    const { user, provisioningEmail } = await createUserForTenant({ tenantId: req.tenant._id, tenant: req.tenant, name, email, password, role, entityId, entityIds, createdByUser: req.currentUser });
    await logAudit({ tenantId: req.tenant._id, actorUserId: req.currentUser._id, action: 'user.created', entityType: 'user', entityId: user._id, after: { name: user.name, email: user.email, role: user.role } });
    req.session.success = `${role === 'agent' ? 'Agent' : 'User'} created successfully with temporary password "password".${provisioningEmail.delivered ? ' Credentials email sent.' : ' Email not sent.'}`;
    return res.redirect(`${req.basePath}/users`);
  } catch (error) {
    req.session.error = error.message || 'Unable to create user.';
    if (error.status && error.status < 500) return res.redirect(`${req.basePath}/users/new${req.body.role ? `?role=${encodeURIComponent(req.body.role)}` : ''}`);
    return next(error);
  }
}

async function listUsersApi(req, res, next) {
  try {
    const role = req.query.role || null;
    let items = await listUsersForTenant(req.tenant._id, role);
    if (req.currentUser.role === 'client') {
      const allowed = await getAccessibleEntityIdsForUser(req.currentUser);
      items = items.filter(({ user, memberships }) => user.role === 'client' && memberships.some((m) => allowed.includes(String(m.entityId?._id || m.entityId))));
    }
    return res.json({ items: items.map(({ user, memberships }) => ({ id: user._id.toString(), name: user.name, email: user.email, role: user.role, isActive: user.isActive, memberships: mapMemberships(memberships) })) });
  } catch (error) { return next(error); }
}

async function createUserApi(req, res, next) {
  try {
    let { name, email, role, entityId } = req.body;
    const password = 'password';
    const entityIds = Array.isArray(req.body.entityIds) ? req.body.entityIds : req.body.entityIds ? [req.body.entityIds] : [];
    if (!entityId && entityIds.length) entityId = entityIds[0];
    if (!['superadmin', 'client'].includes(req.currentUser.role)) return res.status(403).json({ error: 'You do not have access to create users.' });
    if (req.currentUser.role === 'client') {
      role = 'client';
      for (const selectedEntityId of entityIds.length ? entityIds : entityId ? [entityId] : []) {
        if (!(await userHasEntityAccess(req.currentUser, selectedEntityId))) return res.status(403).json({ error: 'You do not have access to one or more selected entities.' });
      }
    }
    const { user, provisioningEmail } = await createUserForTenant({ tenantId: req.tenant._id, tenant: req.tenant, name, email, password, role, entityId, entityIds, createdByUser: req.currentUser });
    const memberships = await getMembershipsForUser({ tenantId: req.tenant._id, userId: user._id, status: 'active' });
    await logAudit({ tenantId: req.tenant._id, actorUserId: req.currentUser._id, action: 'user.created', entityType: 'user', entityId: user._id, after: { name: user.name, email: user.email, role: user.role } });
    return res.status(201).json({ item: { id: user._id.toString(), name: user.name, email: user.email, role: user.role, isActive: user.isActive, memberships: mapMemberships(memberships) }, temporaryPassword: 'password', provisioningEmail });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    return next(error);
  }
}

async function updateUser(req, res, next) {
  try {
    const role = req.body.role;
    const entityIds = Array.isArray(req.body.entityIds) ? req.body.entityIds : req.body.entityIds ? [req.body.entityIds] : [];
    const primaryEntityId = req.body.primaryEntityId || req.body.entityId || entityIds[0] || null;
    const user = await updateUserForTenant({ tenantId: req.tenant._id, userId: req.params.id, updates: { name: req.body.name, email: req.body.email, role, isActive: req.body.isActive === 'true' || req.body.isActive === 'on' || req.body.isActive === true, password: req.body.password || undefined } });
    await createMembershipsForNewUser({ tenantId: req.tenant._id, user, role: user.role, entityId: primaryEntityId, entityIds });
    await logAudit({ tenantId: req.tenant._id, actorUserId: req.currentUser._id, action: 'user.updated', entityType: 'user', entityId: user._id, after: { name: user.name, email: user.email, role: user.role, isActive: user.isActive } });
    const memberships = await getMembershipsForUser({ tenantId: req.tenant._id, userId: user._id, status: 'active' });
    if (req.originalUrl.startsWith('/api/')) return res.json({ item: { id: user._id.toString(), name: user.name, email: user.email, role: user.role, isActive: user.isActive, memberships: mapMemberships(memberships) } });
    req.session.success = 'User updated successfully.';
    return res.redirect(`${req.basePath}/users/${user._id}`);
  } catch (error) {
    if (req.originalUrl.startsWith('/api/') && error.status) return res.status(error.status).json({ error: error.message });
    return next(error);
  }
}

async function getUsersByEntityApi(req, res, next) {
  try {
    const entity = await validateEntityInTenant({ tenantId: req.tenant._id, entityId: req.params.id });
    const memberships = await getMembershipsForEntity({ tenantId: req.tenant._id, entityId: entity._id, status: 'active' });
    return res.json({ entity: { id: entity._id.toString(), name: entity.name, path: entity.path, type: entity.type }, items: memberships.map((membership) => ({ membershipId: membership._id.toString(), id: membership.userId._id.toString(), name: membership.userId.name, email: membership.userId.email, role: membership.userId.role, isPrimary: membership.isPrimary, status: membership.status })) });
  } catch (error) { if (error.status) return res.status(error.status).json({ error: error.message }); return next(error); }
}

async function getUserEntitiesApi(req, res, next) {
  try {
    const user = await validateUserInTenant({ tenantId: req.tenant._id, userId: req.params.id });
    if (req.currentUser.role !== 'superadmin' && String(req.currentUser._id) !== String(user._id)) return res.status(403).json({ error: 'You do not have access to this user.' });
    const memberships = await getMembershipsForUser({ tenantId: req.tenant._id, userId: user._id, status: 'active' });
    return res.json({ user: { id: user._id.toString(), name: user.name, email: user.email, role: user.role }, items: mapMemberships(memberships) });
  } catch (error) { if (error.status) return res.status(error.status).json({ error: error.message }); return next(error); }
}

async function showUserDetail(req, res, next) {
  try {
    const user = await validateUserInTenant({ tenantId: req.tenant._id, userId: req.params.id });
    const memberships = await getMembershipsForUser({ tenantId: req.tenant._id, userId: user._id, status: 'active' });
    const entities = await Entity.find({ tenantId: req.tenant._id, isActive: true }).sort({ path: 1 }).lean();
    return res.render('users/detail', { title: user.name, user, memberships, entities });
  } catch (error) { return next(error); }
}

async function showEntityUsers(req, res, next) {
  try {
    const entity = await validateEntityInTenant({ tenantId: req.tenant._id, entityId: req.params.id });
    if (!(await userHasEntityAccess(req.currentUser, entity._id))) {
      req.session.error = 'You do not have access to this entity.';
      return res.redirect(`${req.basePath}/entities`);
    }
    const memberships = await getMembershipsForEntity({ tenantId: req.tenant._id, entityId: entity._id, status: 'active' });
    return res.render('entities/users', { title: `Users for ${entity.name}`, entity, memberships, mode: 'all' });
  } catch (error) { return next(error); }
}

async function showEntityAgents(req, res, next) {
  try {
    const entity = await validateEntityInTenant({ tenantId: req.tenant._id, entityId: req.params.id });
    if (!(await userHasEntityAccess(req.currentUser, entity._id))) {
      req.session.error = 'You do not have access to this entity.';
      return res.redirect(`${req.basePath}/entities`);
    }
    const memberships = await getMembershipsForEntity({ tenantId: req.tenant._id, entityId: entity._id, status: 'active' });
    return res.render('entities/users', { title: `Agents for ${entity.name}`, entity, memberships: memberships.filter((membership) => membership.userId.role === 'agent'), mode: 'agents' });
  } catch (error) { return next(error); }
}

async function exportUsersExcel(req, res, next) {
  try {
    let items = await listUsersForTenant(req.tenant._id);
    if (req.currentUser.role === 'client') {
      const allowed = await getAccessibleEntityIdsForUser(req.currentUser);
      items = items.filter(({ user, memberships }) => user.role === 'client' && memberships.some((m) => allowed.includes(String(m.entityId?._id || m.entityId))));
    }
    const xml = rowsToExcelXml({ worksheetName: 'Users', headers: ['Name', 'Email', 'Role', 'Entity Access'], rows: items.map(({ user, memberships }) => [user.name, user.email, user.role, memberships.length ? memberships.map((m) => `${m.entityId?.path || 'Unknown'}${m.isPrimary ? ' (primary)' : ''}`).join(', ') : 'All entities']) });
    return sendExcelXml(res, `users-${req.tenant.slug}.xls`, xml);
  } catch (error) { return next(error); }
}


async function showChangePassword(req, res) {
  return res.render('users/change-password', { title: 'Change Password' });
}

async function changeMyPassword(req, res, next) {
  try {
    const { currentPassword, newPassword, confirmPassword } = req.body;
    if (String(newPassword || '') !== String(confirmPassword || '')) {
      req.session.error = 'New password and confirm password must match.';
      return res.redirect(`${req.basePath}/users/account/change-password`);
    }

    await changePasswordForUser({
      tenantId: req.tenant._id,
      userId: req.currentUser._id,
      currentPassword,
      newPassword
    });

    await logAudit({ tenantId: req.tenant._id, actorUserId: req.currentUser._id, action: 'user.password_changed', entityType: 'user', entityId: req.currentUser._id, after: { changedAt: new Date().toISOString() } });

    req.session.success = 'Password changed successfully.';
    return res.redirect(`${req.basePath}/users/account/change-password`);
  } catch (error) {
    if (error.status && error.status < 500) {
      req.session.error = error.message;
      return res.redirect(`${req.basePath}/users/account/change-password`);
    }
    return next(error);
  }
}

module.exports = { listUsers, showCreateUser, createUser, listUsersApi, createUserApi, updateUser, getUsersByEntityApi, getUserEntitiesApi, showUserDetail, showEntityUsers, showEntityAgents, exportUsersExcel, showChangePassword, changeMyPassword };
