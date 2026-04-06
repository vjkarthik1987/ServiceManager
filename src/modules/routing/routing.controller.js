const mongoose = require('mongoose');
const { RoutingRule } = require('./routing-rule.model');
const { SupportGroup } = require('../support-groups/support-group.model');
const { User } = require('../users/user.model');
const { Entity } = require('../entities/entity.model');
const { normalizeCategory, normalizePriority } = require('./routing.service');
const { logAudit } = require('../audit/audit.service');

async function listRoutingRules(req, res, next) {
  try {
    const items = await RoutingRule.find({ tenantId: req.tenant._id })
      .populate('supportGroupId', 'name code')
      .populate('defaultAssigneeUserId', 'name email')
      .populate('entityId', 'name path')
      .sort({ rank: 1, createdAt: 1 });
    if (req.originalUrl.startsWith('/api/')) return res.json({ items });
    const [supportGroups, agents, entities] = await Promise.all([
      SupportGroup.find({ tenantId: req.tenant._id, isActive: true }).sort({ name: 1 }).lean(),
      User.find({ tenantId: req.tenant._id, role: { $in: ['agent', 'superadmin'] }, isActive: true }).sort({ name: 1 }).lean(),
      Entity.find({ tenantId: req.tenant._id, isActive: true }).sort({ path: 1 }).lean()
    ]);
    return res.render('admin-console/routing-rules', { title: 'Routing Rules', items, supportGroups, agents, entities });
  } catch (error) { return next(error); }
}

function parsePayload(body = {}) {
  return {
    name: String(body.name || '').trim(),
    category: normalizeCategory(body.category),
    priority: normalizePriority(body.priority || 'ANY'),
    supportGroupId: body.supportGroupId,
    defaultAssigneeUserId: body.defaultAssigneeUserId || null,
    entityId: body.entityId || null,
    rank: Number(body.rank) || 100,
    executionMode: String(body.executionMode || 'NATIVE').toUpperCase(),
    jiraProjectKey: String(body.jiraProjectKey || '').trim().toUpperCase(),
    isActive: body.isActive === true || body.isActive === 'true' || body.isActive === 'on'
  };
}

async function validateRefs(req, payload) {
  if (!payload.name) throw new Error('name is required');
  if (!payload.supportGroupId || !mongoose.Types.ObjectId.isValid(String(payload.supportGroupId))) throw new Error('valid supportGroupId is required');
  const group = await SupportGroup.findOne({ _id: payload.supportGroupId, tenantId: req.tenant._id, isActive: true });
  if (!group) throw new Error('support group not found');
  if (payload.defaultAssigneeUserId) {
    const user = await User.findOne({ _id: payload.defaultAssigneeUserId, tenantId: req.tenant._id, isActive: true });
    if (!user) throw new Error('default assignee not found');
  }
  if (payload.entityId) {
    const entity = await Entity.findOne({ _id: payload.entityId, tenantId: req.tenant._id, isActive: true });
    if (!entity) throw new Error('entity not found');
  }
  if (!['NATIVE', 'JIRA'].includes(payload.executionMode)) throw new Error('executionMode is invalid');
}

async function createRoutingRule(req, res, next) {
  try {
    const payload = parsePayload(req.body);
    await validateRefs(req, payload);
    const item = await RoutingRule.create({ tenantId: req.tenant._id, ...payload });
    await logAudit({ tenantId: req.tenant._id, actorUserId: req.currentUser._id, action: 'routing_rule.created', entityType: 'routing_rule', entityId: item._id, after: payload });
    const hydrated = await RoutingRule.findById(item._id).populate('supportGroupId', 'name code').populate('defaultAssigneeUserId', 'name email').populate('entityId', 'name path');
    if (req.originalUrl.startsWith('/api/')) return res.status(201).json({ item: hydrated });
    req.session.success = 'Routing rule created.';
    return res.redirect(`${req.basePath}/admin/routing-rules`);
  } catch (error) {
    if (req.originalUrl.startsWith('/api/')) return res.status(400).json({ error: error.message });
    req.session.error = error.message;
    return res.redirect(`${req.basePath}/admin/routing-rules`);
  }
}

async function updateRoutingRule(req, res, next) {
  try {
    const payload = parsePayload(req.body);
    await validateRefs(req, payload);
    const item = await RoutingRule.findOneAndUpdate({ _id: req.params.id, tenantId: req.tenant._id }, { $set: payload }, { new: true }).populate('supportGroupId', 'name code').populate('defaultAssigneeUserId', 'name email').populate('entityId', 'name path');
    if (!item) return res.status(404).json({ error: 'Routing rule not found' });
    await logAudit({ tenantId: req.tenant._id, actorUserId: req.currentUser._id, action: 'routing_rule.updated', entityType: 'routing_rule', entityId: item._id, after: payload });
    return res.json({ item });
  } catch (error) { return res.status(400).json({ error: error.message }); }
}

module.exports = { listRoutingRules, createRoutingRule, updateRoutingRule };
