const mongoose = require('mongoose');

const ticketCommentSchema = new mongoose.Schema(
  {
    authorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    authorType: { type: String, enum: ['client', 'agent', 'superadmin'], required: true },
    body: { type: String, required: true, trim: true },
    isInternal: { type: Boolean, default: false },
    createdAt: { type: Date, default: Date.now }
  },
  { _id: false }
);

const ticketSchema = new mongoose.Schema(
  {
    tenantId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
    ticketNumber: { type: String, required: true, unique: true, index: true },
    raisedByUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    entityId: { type: mongoose.Schema.Types.ObjectId, ref: 'Entity', required: true },
    title: { type: String, required: true, trim: true },
    description: { type: String, required: true, trim: true },
    category: { type: String, default: 'Uncategorized' },
    product: { type: String, default: '' },
    priority: {
      type: String,
      enum: ['low', 'medium', 'high', 'critical'],
      default: 'medium'
    },
    status: {
      type: String,
      enum: ['new', 'under_review', 'assigned', 'resolved', 'closed'],
      default: 'new'
    },
    assignedAgentId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    triage: {
      categorizedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
      categorizedAt: { type: Date, default: null },
      notes: { type: String, default: '' }
    },
    comments: { type: [ticketCommentSchema], default: [] },
    auditVersion: { type: Number, default: 1 }
  },
  { timestamps: true }
);

const Ticket = mongoose.model('Ticket', ticketSchema);

module.exports = { Ticket };
