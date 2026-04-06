const mongoose = require('mongoose');

const SOURCE_TYPES = ['STATIC', 'ISSUE_FIELD', 'ENTITY_METADATA', 'REPORTER', 'CONTEXT'];
const APPLY_MODES = ['DEFAULT_ONLY', 'ALWAYS_OVERRIDE'];
const TRANSFORMS = ['NONE', 'UPPERCASE', 'LOWERCASE', 'CSV', 'PRIORITY_TO_SEVERITY'];

const jiraFieldMappingSchema = new mongoose.Schema(
  {
    tenantId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
    entityId: { type: mongoose.Schema.Types.ObjectId, ref: 'Entity', default: null, index: true },
    projectKey: { type: String, required: true, trim: true, uppercase: true, index: true },
    issueTypeId: { type: String, required: true, trim: true, index: true },
    issueTypeName: { type: String, default: '', trim: true },
    fieldId: { type: String, required: true, trim: true },
    fieldName: { type: String, default: '', trim: true },
    sourceType: { type: String, enum: SOURCE_TYPES, default: 'STATIC', index: true },
    sourcePath: { type: String, default: '', trim: true },
    staticValue: { type: String, default: '', trim: true },
    transform: { type: String, enum: TRANSFORMS, default: 'NONE' },
    applyMode: { type: String, enum: APPLY_MODES, default: 'DEFAULT_ONLY' },
    helpText: { type: String, default: '', trim: true },
    isActive: { type: Boolean, default: true, index: true },
    sortOrder: { type: Number, default: 100 },
    createdByUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    updatedByUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null }
  },
  { timestamps: true }
);

jiraFieldMappingSchema.index(
  { tenantId: 1, entityId: 1, projectKey: 1, issueTypeId: 1, fieldId: 1, isActive: 1 },
  { unique: true, partialFilterExpression: { isActive: true } }
);

const JiraFieldMapping = mongoose.model('JiraFieldMapping', jiraFieldMappingSchema);

module.exports = {
  JiraFieldMapping,
  SOURCE_TYPES,
  APPLY_MODES,
  TRANSFORMS
};
