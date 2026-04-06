const mongoose = require('mongoose');

const issueEventSchema = new mongoose.Schema(
  {
    tenantId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
    issueId: { type: mongoose.Schema.Types.ObjectId, ref: 'Issue', required: true, index: true },
    entityId: { type: mongoose.Schema.Types.ObjectId, ref: 'Entity', required: true, index: true },
    eventType: { type: String, enum: ['status_changed', 'assignee_changed'], required: true },
    actorUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    before: { type: mongoose.Schema.Types.Mixed, default: {} },
    after: { type: mongoose.Schema.Types.Mixed, default: {} }
  },
  { timestamps: true }
);

const IssueEvent = mongoose.model('IssueEvent', issueEventSchema);
module.exports = { IssueEvent };
