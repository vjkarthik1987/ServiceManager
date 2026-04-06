const mongoose = require('mongoose');

const jiraLinkEventSchema = new mongoose.Schema({
  type: { type: String, required: true },
  status: { type: String, default: 'INFO' },
  detail: { type: String, default: '' },
  payload: { type: mongoose.Schema.Types.Mixed, default: null },
  createdAt: { type: Date, default: Date.now }
}, { _id: false });

const jiraLinkSchema = new mongoose.Schema({
  tenantId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  issueId: { type: mongoose.Schema.Types.ObjectId, ref: 'Issue', required: true, unique: true },
  jiraIssueId: { type: String, default: '', index: true },
  jiraIssueKey: { type: String, default: '', index: true },
  projectKey: { type: String, default: '' },
  lastSyncAt: { type: Date, default: null },
  lastSyncStatus: { type: String, default: 'NOT_SYNCED' },
  lastWebhookEventId: { type: String, default: '' },
  lastErrorMessage: { type: String, default: '' },
  pushAttempts: { type: Number, default: 0 },
  events: { type: [jiraLinkEventSchema], default: [] }
}, { timestamps: true });

jiraLinkSchema.index({ tenantId: 1, jiraIssueKey: 1 });

const JiraLink = mongoose.model('JiraLink', jiraLinkSchema);
module.exports = { JiraLink };
