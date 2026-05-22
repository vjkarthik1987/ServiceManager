const mongoose = require('mongoose');

const moduleDefinitionSchema = new mongoose.Schema({
  tenantId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  code: { type: String, required: true, trim: true, uppercase: true },
  name: { type: String, required: true, trim: true },
  description: { type: String, default: '', trim: true },
  ownerTeam: { type: String, default: '', trim: true },
  criticality: { type: String, enum: ['LOW','MEDIUM','HIGH','CRITICAL'], default: 'MEDIUM' },
  isActive: { type: Boolean, default: true, index: true }
}, { timestamps: true });

moduleDefinitionSchema.index({ tenantId: 1, code: 1 }, { unique: true });

const ModuleDefinition = mongoose.model('ModuleDefinition', moduleDefinitionSchema);
module.exports = { ModuleDefinition };
