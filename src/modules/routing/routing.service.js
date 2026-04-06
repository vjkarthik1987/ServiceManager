const mongoose = require('mongoose');
const { RoutingRule } = require('./routing-rule.model');
const { SupportGroup } = require('../support-groups/support-group.model');
const { User } = require('../users/user.model');

function normalizeCategory(value = '') {
  return String(value).trim().toUpperCase() || 'GENERAL';
}

function normalizePriority(value = '') {
  return String(value).trim().toUpperCase() || 'ANY';
}

async function resolveRouting({ tenantId, entityId = null, category, priority = 'ANY' }) {
  const normalizedCategory = normalizeCategory(category);
  const normalizedPriority = normalizePriority(priority);
  const query = {
    tenantId,
    isActive: true,
    category: normalizedCategory,
    priority: { $in: [normalizedPriority, 'ANY'] },
    $or: [{ entityId: null }, ...(entityId && mongoose.Types.ObjectId.isValid(String(entityId)) ? [{ entityId }] : [])]
  };

  const rules = await RoutingRule.find(query)
    .populate('supportGroupId')
    .populate('defaultAssigneeUserId', '_id tenantId isActive role')
    .sort({ rank: 1, entityId: -1, priority: -1, createdAt: 1 });

  const rule = rules[0] || null;
  if (!rule) {
    return { routingStatus: 'NO_MATCH', supportGroupId: null, routingRuleId: null, assignedToUserId: null, executionMode: 'NATIVE', jiraProjectKey: '', matchedRule: null };
  }

  let supportGroupId = rule.supportGroupId?._id || rule.supportGroupId || null;
  let assignedToUserId = rule.defaultAssigneeUserId?._id || rule.defaultAssigneeUserId || null;

  if (!supportGroupId) {
    const group = await SupportGroup.findOne({ tenantId, _id: rule.supportGroupId, isActive: true });
    supportGroupId = group?._id || null;
  }

  if (!assignedToUserId && supportGroupId) {
    const group = await SupportGroup.findOne({ tenantId, _id: supportGroupId, isActive: true });
    if (group?.defaultAssigneeUserId) assignedToUserId = group.defaultAssigneeUserId;
  }

  if (assignedToUserId) {
    const assignee = await User.findOne({ _id: assignedToUserId, tenantId, isActive: true });
    if (!assignee) assignedToUserId = null;
  }

  return {
    routingStatus: 'ROUTED',
    supportGroupId: supportGroupId || null,
    routingRuleId: rule._id,
    assignedToUserId: assignedToUserId || null,
    executionMode: rule.executionMode || 'NATIVE',
    jiraProjectKey: rule.jiraProjectKey || '',
    matchedRule: rule
  };
}

module.exports = { normalizeCategory, normalizePriority, resolveRouting };
