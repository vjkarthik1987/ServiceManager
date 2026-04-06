const mongoose = require('mongoose');

const jiraConfigSchema = new mongoose.Schema(
  {
    isEnabled: { type: Boolean, default: false },
    projectKey: { type: String, default: '', trim: true, uppercase: true },
    projectId: { type: String, default: '', trim: true },
    issueTypeId: { type: String, default: '', trim: true },
    issueTypeName: { type: String, default: '', trim: true },
    autoPushOnCreate: { type: Boolean, default: false },
    inheritFromParent: { type: Boolean, default: true },
    lastMetadataSyncAt: { type: Date, default: null }
  },
  { _id: false }
);

const entitySchema = new mongoose.Schema(
  {
    tenantId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
    name: { type: String, required: true, trim: true },
    acronym: { type: String, required: true, trim: true, uppercase: true, minlength: 4, maxlength: 4 },
    type: { type: String, enum: ['client', 'subclient'], required: true },
    parentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Entity', default: null },
    path: { type: String, required: true, index: true },
    metadata: {
      region: { type: String, default: '' },
      product: { type: String, default: '' },
      productIds: { type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Product' }], default: [] },
      slaTier: { type: String, default: '' }
    },
    commitmentDefaults: {
      inheritFromParent: { type: Boolean, default: true },
      slaPolicyId: { type: mongoose.Schema.Types.ObjectId, ref: 'SlaPolicy', default: null },
      olaPolicyId: { type: mongoose.Schema.Types.ObjectId, ref: 'SlaPolicy', default: null }
    },
    jiraConfig: { type: jiraConfigSchema, default: () => ({}) },
    isActive: { type: Boolean, default: true }
  },
  { timestamps: true }
);

entitySchema.index({ tenantId: 1, acronym: 1 }, { unique: true });

const Entity = mongoose.model('Entity', entitySchema);
module.exports = { Entity };
