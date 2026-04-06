const { Entity } = require('../entities/entity.model');
const { User } = require('../users/user.model');
const { logAudit } = require('../audit/audit.service');
const { assignAgentToEntity } = require('../memberships/membership.service');

async function showAssignAgent(req, res, next) {
  try {
    const [agents, entities] = await Promise.all([
      User.find({ tenantId: req.tenant._id, role: 'agent', isActive: true }).sort({ name: 1 }),
      Entity.find({ tenantId: req.tenant._id, isActive: true }).sort({ path: 1 })
    ]);

    return res.render('assignments/new', {
      title: 'Assign Agent to Entity',
      agents,
      entities
    });
  } catch (error) {
    return next(error);
  }
}

async function createAssignment(req, res, next) {
  try {
    const { agentUserId, entityId } = req.body;
    const membership = await assignAgentToEntity({
      tenantId: req.tenant._id,
      agentUserId,
      entityId
    });

    await logAudit({
      tenantId: req.tenant._id,
      actorUserId: req.currentUser._id,
      action: 'assignment.agent_entity.created',
      entityType: 'membership',
      entityId: membership._id,
      after: {
        userId: membership.userId,
        entityId: membership.entityId,
        status: membership.status
      }
    });

    req.session.success = 'Agent assigned successfully.';
    return res.redirect(`${req.basePath}/assignments/new`);
  } catch (error) {
    req.session.error = error.message || 'Unable to assign agent.';
    if (error.status && error.status < 500) return res.redirect(`${req.basePath}/assignments/new`);
    return next(error);
  }
}

async function createAssignmentApi(req, res, next) {
  try {
    const { agentUserId, entityId } = req.body;
    const membership = await assignAgentToEntity({
      tenantId: req.tenant._id,
      agentUserId,
      entityId
    });

    await logAudit({
      tenantId: req.tenant._id,
      actorUserId: req.currentUser._id,
      action: 'assignment.agent_entity.created',
      entityType: 'membership',
      entityId: membership._id,
      after: {
        userId: membership.userId,
        entityId: membership.entityId,
        status: membership.status
      }
    });

    return res.status(201).json({
      item: {
        id: membership._id.toString(),
        userId: membership.userId.toString(),
        entityId: membership.entityId.toString(),
        isPrimary: membership.isPrimary,
        status: membership.status
      }
    });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    return next(error);
  }
}

module.exports = { showAssignAgent, createAssignment, createAssignmentApi };
