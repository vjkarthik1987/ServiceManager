
const mongoose = require('mongoose');

const jiraWebhookEventSchema = new mongoose.Schema({
  tenantId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  eventId: { type: String, required: true },
  fingerprint: { type: String, default: '', index: true },
  issueKey: { type: String, default: '' },
  processedAt: { type: Date, default: Date.now },
  payload: { type: mongoose.Schema.Types.Mixed, default: null }
}, { timestamps: true });

jiraWebhookEventSchema.index({ tenantId: 1, eventId: 1 }, { unique: true });
jiraWebhookEventSchema.index({ tenantId: 1, fingerprint: 1 }, { unique: true, partialFilterExpression: { fingerprint: { $type: 'string', $ne: '' } } });

const JiraWebhookEvent = mongoose.model('JiraWebhookEvent', jiraWebhookEventSchema);
module.exports = { JiraWebhookEvent };
