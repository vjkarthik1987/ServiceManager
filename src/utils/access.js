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
  if (user.role === 'superadmin') {
    const entities = await Entity.find({ tenantId: user.tenantId, isActive: true }).select('_id');
    return entities.map((item) => String(item._id));
  }

  const memberships = await UserEntityMembership.find({
    tenantId: user.tenantId,
    userId: user._id,
    status: 'active'
  }).populate('entityId');

  const exactIds = memberships
    .map((membership) => normalizeId(membership.entityId))
    .filter(Boolean);

  if (!exactIds.length) return [];

  const entities = await Entity.find({ tenantId: user.tenantId, isActive: true }).select('_id path');
  const exactById = new Map(memberships.map((membership) => [normalizeId(membership.entityId), membership.entityId]));
  const allowed = new Set(exactIds);

  if (user.role === 'client') {
    for (const entity of entities) {
      for (const exactId of exactIds) {
        const source = exactById.get(exactId);
        if (source && (entity.path === source.path || entity.path.startsWith(`${source.path} / `))) {
          allowed.add(String(entity._id));
        }
      }
    }
    return Array.from(allowed);
  }

  for (const entity of entities) {
    for (const exactId of exactIds) {
      const source = exactById.get(exactId);
      if (source && (entity.path === source.path || entity.path.startsWith(`${source.path} / `))) {
        allowed.add(String(entity._id));
      }
    }
  }

  return Array.from(allowed);
}

async function userHasEntityAccess(user, entityId) {
  if (!user || !entityId) return false;
  if (user.role === 'superadmin') return true;
  const allowed = await getAccessibleEntityIdsForUser(user);
  return allowed.includes(String(entityId));
}

async function getAssignableAgentsForEntity({ tenantId, entityId }) {
  const memberships = await UserEntityMembership.find({ tenantId, entityId, status: 'active' }).populate('userId');
  return memberships
    .filter((membership) => membership.userId && membership.userId.role === 'agent' && membership.userId.isActive)
    .map((membership) => membership.userId);
}

async function validateAssignableAgentForEntity({ tenantId, agentUserId, entityId }) {
  if (!mongoose.Types.ObjectId.isValid(agentUserId)) {
    const err = new Error('Assignee is invalid.');
    err.status = 400;
    throw err;
  }

  const user = await User.findOne({ _id: agentUserId, tenantId, role: 'agent', isActive: true });
  if (!user) {
    const err = new Error('Assignee must be an active agent.');
    err.status = 400;
    throw err;
  }

  const membership = await UserEntityMembership.findOne({
    tenantId,
    userId: user._id,
    entityId,
    status: 'active'
  });

  if (!membership) {
    const err = new Error('Assignee does not have access to the selected entity.');
    err.status = 400;
    throw err;
  }

  return user;
}

module.exports = {
  normalizeId,
  getAccessibleEntityIdsForUser,
  userHasEntityAccess,
  getAssignableAgentsForEntity,
  validateAssignableAgentForEntity
};
