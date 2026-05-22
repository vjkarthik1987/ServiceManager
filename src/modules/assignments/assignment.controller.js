const { Entity } = require('../entities/entity.model');
const { User } = require('../users/user.model');
const { logAudit } = require('../audit/audit.service');
const { assignAgentToEntity } = require('../memberships/membership.service');
const { UserEntityMembership } = require('../memberships/membership.model');

async function showAssignAgent(req, res, next) {
  try {
    const [agents, entities, memberships] = await Promise.all([
      User.find({ tenantId: req.tenant._id, role: { $in: ['agent', 'agent_user', 'agent_manager'] }, isActive: true }).sort({ name: 1 }),
      Entity.find({ tenantId: req.tenant._id, isActive: true }).sort({ path: 1 }),
      UserEntityMembership.find({ tenantId: req.tenant._id, status: 'active' }).populate('userId entityId').lean()
    ]);

    const assignmentTable = agents.map((agent) => {
      const rows = memberships.filter((membership) => String(membership.userId?._id || membership.userId) === String(agent._id));
      return {
        _id: agent._id,
        name: agent.name,
        email: agent.email,
        role: agent.role,
        isActive: agent.isActive,
        entities: rows.map((membership) => ({
          membershipId: membership._id,
          _id: membership.entityId?._id || membership.entityId,
          name: membership.entityId?.name || '',
          path: membership.entityId?.path || '',
          type: membership.entityId?.type || '',
          isPrimary: !!membership.isPrimary
        }))
      };
    });

    return res.render('assignments/new', {
      title: 'Agent Assignment',
      agents,
      entities,
      assignmentTable
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

    req.session.success = 'Agent assignment saved successfully.';
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


async function removeAssignment(req, res, next) {
  try {
    const membership = await UserEntityMembership.findOne({ _id: req.params.membershipId, tenantId: req.tenant._id, status: 'active' });
    if (!membership) {
      req.session.error = 'Assignment not found.';
      return res.redirect(`${req.basePath}/assignments/new`);
    }

    membership.status = 'inactive';
    await membership.save();

    await logAudit({
      tenantId: req.tenant._id,
      actorUserId: req.currentUser._id,
      action: 'assignment.agent_entity.removed',
      entityType: 'membership',
      entityId: membership._id,
      after: {
        userId: membership.userId,
        entityId: membership.entityId,
        status: membership.status
      }
    });

    req.session.success = 'Agent assignment removed successfully.';
    return res.redirect(`${req.basePath}/assignments/new`);
  } catch (error) {
    req.session.error = error.message || 'Unable to remove agent assignment.';
    if (error.status && error.status < 500) return res.redirect(`${req.basePath}/assignments/new`);
    return next(error);
  }
}

module.exports = { showAssignAgent, createAssignment, createAssignmentApi, removeAssignment };
