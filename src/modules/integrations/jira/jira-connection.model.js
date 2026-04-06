
const mongoose = require('mongoose');

const jiraConnectionSchema = new mongoose.Schema(
  {
    tenantId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
    baseUrl: { type: String, required: true, trim: true },
    email: { type: String, required: true, trim: true, lowercase: true },
    apiToken: { type: String, required: true, trim: true, select: false },
    projectKeyDefault: { type: String, default: '', trim: true, uppercase: true },
    issueTypeIdDefault: { type: String, default: '', trim: true },
    issueTypeNameDefault: { type: String, default: '', trim: true },
    webhookSecret: { type: String, default: '', trim: true, select: false },
    intake: {
      minimalMode: { type: Boolean, default: false },
      projectKey: { type: String, default: '', trim: true, uppercase: true },
      issueTypeName: { type: String, default: '' , trim: true },
      defaultStatusAfterPush: { type: String, default: 'PUSHED_TO_JIRA', trim: true },
      pushAttachments: { type: Boolean, default: true },
      isActive: { type: Boolean, default: false }
    },
    isActive: { type: Boolean, default: true, index: true },
    lastValidatedAt: { type: Date, default: null },
    lastValidationStatus: {
      type: String,
      enum: ['SUCCESS', 'FAILED', 'NEVER_VALIDATED'],
      default: 'NEVER_VALIDATED',
      index: true
    },
    lastValidationMessage: { type: String, default: '', trim: true }
  },
  { timestamps: true }
);

jiraConnectionSchema.index(
  { tenantId: 1, isActive: 1 },
  { unique: true, partialFilterExpression: { isActive: true } }
);

const JiraConnection = mongoose.model('JiraConnection', jiraConnectionSchema);

module.exports = { JiraConnection };
