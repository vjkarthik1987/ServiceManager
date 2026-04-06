const mongoose = require('mongoose');

const fileAttachmentSchema = new mongoose.Schema(
  {
    _id: { type: mongoose.Schema.Types.ObjectId, auto: true },
    filename: { type: String, trim: true },
    fileName: { type: String, trim: true },
    originalName: { type: String, required: true, trim: true },
    mimeType: { type: String, default: 'application/octet-stream', trim: true },
    fileType: { type: String, default: 'application/octet-stream', trim: true },
    size: { type: Number, default: 0 },
    tenantId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
    issueId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
    uploadedByUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    createdAt: { type: Date, default: Date.now },
    uploadedAt: { type: Date, default: Date.now },
    storageProvider: { type: String, default: 'local' },
    storagePath: { type: String, trim: true },
    url: { type: String, default: null }
  },
  { _id: false }
);

module.exports = { fileAttachmentSchema };
