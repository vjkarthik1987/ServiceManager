import mongoose from 'mongoose';

const auditActorSchema = new mongoose.Schema(
  {
    actorId: { type: String, trim: true, default: '' },
    name: { type: String, trim: true, maxlength: 140, default: '' },
    email: { type: String, trim: true, lowercase: true, maxlength: 180, default: '' },
    role: { type: String, trim: true, maxlength: 80, default: '' },
    portal: { type: String, trim: true, maxlength: 40, default: '' }
  },
  { _id: false }
);

const auditLogSchema = new mongoose.Schema(
  {
    organizationId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
    eventType: { type: String, trim: true, maxlength: 80, required: true, index: true },
    message: { type: String, trim: true, maxlength: 1000, required: true },
    targetType: { type: String, trim: true, maxlength: 80, default: '' },
    targetId: { type: String, trim: true, maxlength: 120, default: '' },
    targetLabel: { type: String, trim: true, maxlength: 180, default: '' },
    actor: { type: auditActorSchema, default: () => ({}) },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} }
  },
  { timestamps: true }
);

auditLogSchema.index({ organizationId: 1, createdAt: -1 });
auditLogSchema.index({ organizationId: 1, eventType: 1, createdAt: -1 });

export const AuditLog = mongoose.model('AuditLog', auditLogSchema);
