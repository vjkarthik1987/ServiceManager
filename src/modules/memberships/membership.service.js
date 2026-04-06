const mongoose = require('mongoose');
const { UserEntityMembership } = require('./membership.model');
const { User } = require('../users/user.model');
const { Entity } = require('../entities/entity.model');

function toObjectId(value, fieldName) {
  if (!mongoose.Types.ObjectId.isValid(value)) {
    const err = new Error(`${fieldName} is invalid.`);
    err.status = 400;
    throw err;
  }
  return new mongoose.Types.ObjectId(value);
}

async function validateEntityInTenant({ tenantId, entityId }) {
  const _id = toObjectId(entityId, 'Entity id');
  const entity = await Entity.findOne({ _id, tenantId, isActive: true });
  if (!entity) {
    const err = new Error('Selected entity was not found.');
    err.status = 404;
    throw err;
  }
  return entity;
}

async function validateUserInTenant({ tenantId, userId, includeInactive = true }) {
  const _id = toObjectId(userId, 'User id');
  const filter = { _id, tenantId };

  if (!includeInactive) {
    filter.isActive = true;
  }

  const user = await User.findOne(filter);
  if (!user) {
    const err = new Error('Selected user was not found.');
    err.status = 404;
    throw err;
  }
  return user;
}

async function replaceMembershipsForUser({ tenantId, userId, memberships }) {
  await UserEntityMembership.deleteMany({ tenantId, userId });
  if (!memberships.length) return [];
  return UserEntityMembership.insertMany(
    memberships.map((item) => ({
      tenantId,
      userId,
      entityId: item.entityId,
      roleWithinEntity: item.roleWithinEntity || '',
      isPrimary: Boolean(item.isPrimary),
      status: item.status || 'active'
    }))
  );
}

async function createMembershipsForNewUser({ tenantId, user, role, entityId, entityIds = [] }) {
  if (role === 'superadmin') return [];

  if (role === 'client') {
    const normalizedIds = Array.from(
      new Set(
        [
          ...(Array.isArray(entityIds) ? entityIds : []),
          ...(entityId ? [entityId] : [])
        ]
          .filter(Boolean)
          .map((value) => String(value))
      )
    );

    if (!normalizedIds.length) {
      const err = new Error('At least one entity is required for client users.');
      err.status = 400;
      throw err;
    }

    const primaryCandidate = entityId && normalizedIds.includes(String(entityId)) ? String(entityId) : normalizedIds[0];
    const memberships = [];
    for (const id of normalizedIds) {
      const entity = await validateEntityInTenant({ tenantId, entityId: id });
      memberships.push({ entityId: entity._id, isPrimary: String(entity._id) == String(primaryCandidate), status: 'active' });
    }
    return replaceMembershipsForUser({ tenantId, userId: user._id, memberships });
  }

  if (role === 'agent') {
    const normalizedIds = Array.from(
      new Set(
        [
          ...(Array.isArray(entityIds) ? entityIds : []),
          ...(entityId ? [entityId] : [])
        ]
          .filter(Boolean)
          .map((value) => String(value))
      )
    );

    const memberships = [];
    for (const id of normalizedIds) {
      const entity = await validateEntityInTenant({ tenantId, entityId: id });
      memberships.push({ entityId: entity._id, isPrimary: false, status: 'active' });
    }
    return replaceMembershipsForUser({ tenantId, userId: user._id, memberships });
  }

  return [];
}

async function assignAgentToEntity({ tenantId, agentUserId, entityId }) {
  const agent = await validateUserInTenant({ tenantId, userId: agentUserId });
  if (agent.role !== 'agent') {
    const err = new Error('Only agent users can be assigned to entities.');
    err.status = 400;
    throw err;
  }

  const entity = await validateEntityInTenant({ tenantId, entityId });

  const existing = await UserEntityMembership.findOne({
    tenantId,
    userId: agent._id,
    entityId: entity._id
  });

  if (existing) {
    if (existing.status !== 'active') {
      existing.status = 'active';
      await existing.save();
    }
    return existing;
  }

  return UserEntityMembership.create({
    tenantId,
    userId: agent._id,
    entityId: entity._id,
    isPrimary: false,
    status: 'active'
  });
}

async function getMembershipsForUser({ tenantId, userId, status = 'active' }) {
  const filter = { tenantId, userId };
  if (status) filter.status = status;
  return UserEntityMembership.find(filter).populate('entityId').sort({ isPrimary: -1, createdAt: 1 });
}

async function getMembershipsForEntity({ tenantId, entityId, status = 'active' }) {
  const filter = { tenantId, entityId };
  if (status) filter.status = status;
  return UserEntityMembership.find(filter).populate('userId entityId').sort({ isPrimary: -1, createdAt: 1 });
}

async function getAccessibleEntityIdsForUser(user) {
  if (!user) return [];
  if (user.role === 'superadmin') return null;
  const memberships = await getMembershipsForUser({ tenantId: user.tenantId, userId: user._id, status: 'active' });
  return memberships.map((membership) => String(membership.entityId?._id || membership.entityId));
}

module.exports = {
  validateEntityInTenant,
  validateUserInTenant,
  createMembershipsForNewUser,
  assignAgentToEntity,
  getMembershipsForUser,
  getMembershipsForEntity,
  getAccessibleEntityIdsForUser
};
