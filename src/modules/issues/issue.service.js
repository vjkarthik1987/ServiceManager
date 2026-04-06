const mongoose = require('mongoose');
const { IssueCounter } = require('./issue-counter.model');
const { Entity } = require('../entities/entity.model');
const { IssueActivity } = require('./issue-activity.model');

function normalizeObjectId(value, fieldName) {
  if (!mongoose.Types.ObjectId.isValid(value)) {
    const error = new Error(`${fieldName} is invalid for issue number generation.`);
    error.status = 400;
    throw error;
  }
  return new mongoose.Types.ObjectId(String(value));
}

async function generateIssueNumber({ tenantId, entity }) {
  if (!entity || !entity._id) {
    const error = new Error('Entity is required for issue number generation');
    error.status = 400;
    throw error;
  }

  const normalizedTenantId = normalizeObjectId(tenantId, 'tenantId');
  const normalizedEntityId = normalizeObjectId(entity._id, 'entityId');

  const acronym = String(entity.acronym || '').trim().toUpperCase();
  if (!acronym) {
    const error = new Error('Entity acronym is required before issue numbers can be generated.');
    error.status = 400;
    throw error;
  }

  let counter = await IssueCounter.findOne({
    tenantId: normalizedTenantId,
    entityId: normalizedEntityId
  });

  if (!counter) {
    try {
      await IssueCounter.create({
        tenantId: normalizedTenantId,
        entityId: normalizedEntityId,
        acronym,
        sequence: 1000
      });
    } catch (error) {
      if (!(error && error.code === 11000)) {
        throw error;
      }
    }
  }

  counter = await IssueCounter.findOneAndUpdate(
    { tenantId: normalizedTenantId, entityId: normalizedEntityId },
    {
      $inc: { sequence: 1 },
      $set: { acronym }
    },
    {
      new: true,
      runValidators: false
    }
  );

  if (!counter) {
    const error = new Error('Issue counter could not be created or incremented.');
    error.status = 500;
    throw error;
  }

  return `${acronym}-${counter.sequence}`;
}

async function listCreatableEntitiesForUser(user) {
  if (user.role === 'superadmin') {
    return Entity.find({ tenantId: user.tenantId, isActive: true }).sort({ path: 1 }).lean();
  }

  const { getAccessibleEntityIdsForUser } = require('../../utils/access');
  const allowedEntityIds = await getAccessibleEntityIdsForUser(user);
  return Entity.find({ tenantId: user.tenantId, _id: { $in: allowedEntityIds }, isActive: true })
    .sort({ path: 1 })
    .lean();
}

async function createIssueActivity({ tenantId, issueId, entityId, type, metadata = {}, performedByUserId, performedByRole }) {
  return IssueActivity.create({ tenantId, issueId, entityId, type, metadata, performedByUserId, performedByRole });
}

module.exports = { generateIssueNumber, listCreatableEntitiesForUser, createIssueActivity };
