const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema({
  tenantId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  issueId: { type: mongoose.Schema.Types.ObjectId, ref: 'Issue', default: null, index: true },
  type: { type: String, required: true },
  channel: { type: String, enum: ['IN_APP', 'EMAIL'], default: 'IN_APP' },
  recipientUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  recipientEmail: { type: String, default: '' },
  subject: { type: String, default: '' },
  body: { type: String, default: '' },
  status: { type: String, enum: ['PENDING', 'QUEUED', 'SENT', 'FAILED', 'SUPPRESSED'], default: 'PENDING', index: true },
  sentAt: { type: Date, default: null },
  failureReason: { type: String, default: '' },
  templateKey: { type: String, default: '' },
  digestKey: { type: String, default: '' },
  retryCount: { type: Number, default: 0 },
  nextAttemptAt: { type: Date, default: null },
  metadata: { type: mongoose.Schema.Types.Mixed, default: null },
  readAt: { type: Date, default: null, index: true }
}, { timestamps: true });

const Notification = mongoose.model('Notification', notificationSchema);
module.exports = { Notification };
