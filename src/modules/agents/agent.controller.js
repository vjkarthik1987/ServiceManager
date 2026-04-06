const { listUsersForTenant } = require('../users/user.service');

async function listAgentsApi(req, res, next) {
  try {
    const agents = await listUsersForTenant(req.tenant._id, 'agent');
    return res.json({
      items: agents.map(({ user, memberships }) => ({
        id: user._id.toString(),
        name: user.name,
        email: user.email,
        role: user.role,
        isActive: user.isActive,
        memberships: memberships.map((membership) => ({
          id: membership._id.toString(),
          entityId: membership.entityId?._id?.toString() || membership.entityId?.toString(),
          entityName: membership.entityId?.name || null,
          entityPath: membership.entityId?.path || null,
          isPrimary: membership.isPrimary,
          status: membership.status
        }))
      }))
    });
  } catch (error) {
    return next(error);
  }
}

module.exports = { listAgentsApi };
