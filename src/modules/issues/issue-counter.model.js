const mongoose = require('mongoose');

const issueCounterSchema = new mongoose.Schema(
  {
    tenantId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
    entityId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
    acronym: { type: String, required: true, trim: true, uppercase: true, minlength: 4, maxlength: 4 },
    sequence: { type: Number, default: 1000 }
  },
  { timestamps: true }
);

issueCounterSchema.index({ tenantId: 1, entityId: 1 }, { unique: true });
issueCounterSchema.index({ tenantId: 1, acronym: 1 });

const IssueCounter = mongoose.model('IssueCounter', issueCounterSchema);
module.exports = { IssueCounter };
