
const mongoose = require('mongoose');

const entityJiraFieldSchema = new mongoose.Schema(
  {
    fieldId: { type: String, required: true },
    key: { type: String, default: '' },
    name: { type: String, default: '' },
    required: { type: Boolean, default: false },
    schemaType: { type: String, default: '' },
    uiType: { type: String, default: '' },
    allowedValues: { type: [mongoose.Schema.Types.Mixed], default: [] }
  },
  { _id: false }
);

const entityJiraFieldMetadataSchema = new mongoose.Schema(
  {
    tenantId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
    entityId: { type: mongoose.Schema.Types.ObjectId, required: true, ref: 'Entity', index: true },
    projectKey: { type: String, required: true, uppercase: true, trim: true },
    issueTypeId: { type: String, required: true, trim: true },
    issueTypeName: { type: String, default: '', trim: true },
    fields: { type: [entityJiraFieldSchema], default: [] },
    source: { type: String, enum: ['LIVE', 'MOCK', 'CACHE'], default: 'LIVE' },
    lastSyncedAt: { type: Date, default: Date.now }
  },
  { timestamps: true }
);

entityJiraFieldMetadataSchema.index({ tenantId: 1, entityId: 1, projectKey: 1, issueTypeId: 1 }, { unique: true });

const EntityJiraFieldMetadata = mongoose.model('EntityJiraFieldMetadata', entityJiraFieldMetadataSchema);
module.exports = { EntityJiraFieldMetadata };
