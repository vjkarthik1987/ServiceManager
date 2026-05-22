const mongoose = require('mongoose');

const jobSchema = new mongoose.Schema({
  tenantId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  type: { type: String, required: true, index: true },
  status: { type: String, enum: ['PENDING', 'PROCESSING', 'DONE', 'FAILED', 'DLQ'], default: 'PENDING', index: true },
  payload: { type: mongoose.Schema.Types.Mixed, required: true },
  attempts: { type: Number, default: 0 },
  maxAttempts: { type: Number, default: 3 },
  lastError: { type: String, default: '' },
  availableAt: { type: Date, default: Date.now, index: true },
  lockedAt: { type: Date, default: null },
  processedAt: { type: Date, default: null }
}, { timestamps: true });

jobSchema.index({ status: 1, availableAt: 1, type: 1 });

const QueueJob = mongoose.model('QueueJob', jobSchema);
module.exports = { QueueJob };
