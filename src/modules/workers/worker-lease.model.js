const mongoose = require('mongoose');

const workerLeaseSchema = new mongoose.Schema({
  name: { type: String, required: true, unique: true },
  ownerId: { type: String, required: true, index: true },
  expiresAt: { type: Date, required: true, index: true }
}, { timestamps: true });

const WorkerLease = mongoose.model('WorkerLease', workerLeaseSchema);
module.exports = { WorkerLease };
