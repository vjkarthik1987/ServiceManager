const mongoose = require('mongoose');

const knowledgeDocumentSchema = new mongoose.Schema({
  tenantId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  uploadedByUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  title: { type: String, required: true, trim: true },
  sourceType: { type: String, enum: ['ISSUE_DATABASE', 'RCA_LIBRARY', 'KB_ARTICLE', 'JIRA_EXPORT', 'AUTO_KB_DRAFT', 'RUNBOOK_DRAFT', 'CLIENT_SIGNAL', 'MAIL_UPLOAD', 'OTHER'], default: 'ISSUE_DATABASE', index: true },
  visibilityScope: { type: String, enum: ['ALL_CUSTOMERS', 'INTERNAL_ONLY', 'SPECIFIC_CUSTOMERS'], default: 'INTERNAL_ONLY', index: true },
  scopedEntityIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Entity', index: true }],
  originalName: { type: String, default: '', trim: true },
  mimeType: { type: String, default: '', trim: true },
  size: { type: Number, default: 0 },
  rawText: { type: String, default: '' },
  rowsIngested: { type: Number, default: 0 },
  learningStatus: { type: String, enum: ['UPLOADED', 'PARSED', 'DRAFT', 'PUBLISHED', 'FAILED'], default: 'UPLOADED', index: true },
  knowledgeStatus: { type: String, enum: ['DRAFT', 'REVIEWED', 'PUBLISHED', 'ARCHIVED'], default: 'DRAFT', index: true },
  sourceIssueId: { type: mongoose.Schema.Types.ObjectId, ref: 'Issue', default: null, index: true },
  confidence: { type: Number, default: null },
  parseError: { type: String, default: '' },
  tags: { type: [String], default: [] },
  metadata: { type: mongoose.Schema.Types.Mixed, default: {} }
}, { timestamps: true });

knowledgeDocumentSchema.index({ tenantId: 1, createdAt: -1 });
knowledgeDocumentSchema.index({ tenantId: 1, sourceType: 1, learningStatus: 1 });
knowledgeDocumentSchema.index({ tenantId: 1, visibilityScope: 1, scopedEntityIds: 1 });
knowledgeDocumentSchema.index({ title: 'text', rawText: 'text', tags: 'text' });

module.exports = { KnowledgeDocument: mongoose.model('KnowledgeDocument', knowledgeDocumentSchema) };
