const mongoose = require('mongoose');

const fileAssetSchema = new mongoose.Schema(
  {
    filename: { type: String, required: true, trim: true },
    originalName: { type: String, required: true, trim: true },
    mimeType: { type: String, default: 'application/octet-stream', trim: true },
    size: { type: Number, default: 0 },
    tenantId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
    issueId: { type: mongoose.Schema.Types.ObjectId, ref: 'Issue', required: true, index: true },
    commentId: { type: mongoose.Schema.Types.ObjectId, ref: 'IssueComment', default: null, index: true },
    uploadedByUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    storageProvider: { type: String, enum: ['local', 's3'], default: 'local' },
    storagePath: { type: String, required: true, trim: true },
    entityId: { type: mongoose.Schema.Types.ObjectId, ref: 'Entity', default: null, index: true }
  },
  { timestamps: true }
);

fileAssetSchema.index({ tenantId: 1, issueId: 1, commentId: 1, createdAt: -1 });
fileAssetSchema.index({ tenantId: 1, entityId: 1, createdAt: -1 });

const FileAsset = mongoose.model('FileAsset', fileAssetSchema);

module.exports = { FileAsset };
