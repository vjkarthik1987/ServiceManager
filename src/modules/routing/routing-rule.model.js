const mongoose = require('mongoose');

const routingRuleSchema = new mongoose.Schema(
  {
    tenantId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
    name: { type: String, required: true, trim: true },
    category: { type: String, required: true, trim: true, uppercase: true, index: true },
    priority: { type: String, default: 'ANY', trim: true, uppercase: true, index: true },
    entityId: { type: mongoose.Schema.Types.ObjectId, ref: 'Entity', default: null, index: true },
    supportGroupId: { type: mongoose.Schema.Types.ObjectId, ref: 'SupportGroup', required: true, index: true },
    defaultAssigneeUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    executionMode: { type: String, enum: ['NATIVE', 'JIRA'], default: 'NATIVE' },
    jiraProjectKey: { type: String, default: '', trim: true, uppercase: true },
    isActive: { type: Boolean, default: true, index: true },
    rank: { type: Number, default: 100, index: true }
  },
  { timestamps: true }
);

routingRuleSchema.index({ tenantId: 1, category: 1, priority: 1, entityId: 1, rank: 1 });
const RoutingRule = mongoose.model('RoutingRule', routingRuleSchema);
module.exports = { RoutingRule };
