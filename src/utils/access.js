const { AGENT_ASSIGNABLE_ROLES } = require('./roles');
const mongoose = require('mongoose');
const { Entity } = require('../modules/entities/entity.model');
const { UserEntityMembership } = require('../modules/memberships/membership.model');
const { User } = require('../modules/users/user.model');

function normalizeId(value) {
  if (!value) return null;
  if (typeof value === 'string') return value;
  if (value._id) return String(value._id);
  return String(value);
}

async function getAccessibleEntityIdsForUser(user) {
  if (!user) return [];
  if (Array.isArray(user.__accessibleEntityIds)) return user.__accessibleEntityIds;
  if (user.role === 'superadmin') {
    const entities = await Entity.find({ tenantId: user.tenantId, isActive: true }).select('_id').lean();
    user.__accessibleEntityIds = entities.map((item) => String(item._id));
    return user.__accessibleEntityIds;
  }

  const memberships = Array.isArray(user.memberships) && user.memberships.length
    ? user.memberships
    : await UserEntityMembership.find({
        tenantId: user.tenantId,
        userId: user._id,
        status: 'active'
      }).populate('entityId');

  const exactIds = memberships.map((membership) => normalizeId(membership.entityId)).filter(Boolean);
  if (!exactIds.length) {
    user.__accessibleEntityIds = [];
    return user.__accessibleEntityIds;
  }

  const exactById = new Map(memberships.map((membership) => [normalizeId(membership.entityId), membership.entityId]));
  const sourcePaths = exactIds.map((exactId) => exactById.get(exactId)?.path).filter(Boolean);
  if (!sourcePaths.length) {
    user.__accessibleEntityIds = exactIds;
    return user.__accessibleEntityIds;
  }

  const entities = await Entity.find({ tenantId: user.tenantId, isActive: true }).select('_id path').lean();
  const allowed = new Set(exactIds);
  for (const entity of entities) {
    for (const sourcePath of sourcePaths) {
      if (entity.path === sourcePath || entity.path.startsWith(`${sourcePath} / `)) {
        allowed.add(String(entity._id));
        break;
      }
    }
  }

  user.__accessibleEntityIds = Array.from(allowed);
  return user.__accessibleEntityIds;
}


function getAccessibleEntityIdSetFromUser(user) {
  if (!user) return new Set();
  if (user.__accessibleEntityIdSet instanceof Set) return user.__accessibleEntityIdSet;
  if (Array.isArray(user.__accessibleEntityIds)) {
    user.__accessibleEntityIdSet = new Set(user.__accessibleEntityIds.map(String));
    return user.__accessibleEntityIdSet;
  }
  return new Set();
}

async function getAccessibleEntityIdSetForUser(user) {
  if (!user) return new Set();
  const cached = getAccessibleEntityIdSetFromUser(user);
  if (cached.size || Array.isArray(user.__accessibleEntityIds)) return cached;
  const ids = await getAccessibleEntityIdsForUser(user);
  user.__accessibleEntityIdSet = new Set(ids.map(String));
  return user.__accessibleEntityIdSet;
}

async function userHasEntityAccess(user, entityId) {
  if (!user || !entityId) return false;
  if (user.role === 'superadmin') return true;
  const targetId = String(entityId);
  const allowedSet = await getAccessibleEntityIdSetForUser(user);
  return allowedSet.has(targetId);
}

async function getAssignableAgentsForEntity({ tenantId, entityId }) {
  const users = await User.find({ tenantId, role: { $in: AGENT_ASSIGNABLE_ROLES }, isActive: true }).sort({ name: 1 });
  const allowed = [];
  const fallback = [];
  for (const user of users) {
    const scopedIds = await getAccessibleEntityIdsForUser(user);
    if (Array.isArray(scopedIds) && scopedIds.includes(String(entityId))) allowed.push(user);
    if (!Array.isArray(scopedIds) || !scopedIds.length) fallback.push(user);
  }
  return allowed.length ? allowed : users;
}

async function validateAssignableAgentForEntity({ tenantId, agentUserId, entityId }) {
  if (!mongoose.Types.ObjectId.isValid(agentUserId)) {
    const err = new Error('Assignee is invalid.');
    err.status = 400;
    throw err;
  }

  const user = await User.findOne({ _id: agentUserId, tenantId, role: { $in: AGENT_ASSIGNABLE_ROLES }, isActive: true });
  if (!user) {
    const err = new Error('Assignee must be an active agent user or agent manager.');
    err.status = 400;
    throw err;
  }

  const scopedIds = await getAccessibleEntityIdsForUser(user);
  if (Array.isArray(scopedIds) && scopedIds.length && !scopedIds.includes(String(entityId))) {
    const err = new Error('Assignee does not have access to the selected entity.');
    err.status = 400;
    throw err;
  }

  return user;
}

module.exports = {
  normalizeId,
  getAccessibleEntityIdsForUser,
  getAccessibleEntityIdSetForUser,
  userHasEntityAccess,
  getAssignableAgentsForEntity,
  validateAssignableAgentForEntity
};
