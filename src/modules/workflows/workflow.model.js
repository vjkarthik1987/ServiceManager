
const mongoose = require('mongoose');
const transitionSchema = new mongoose.Schema({ fromStatus: String, toStatus: String, rolesAllowed: [String], requiresApproval: { type: Boolean, default: false } }, { _id: false });
const fieldPermissionSchema = new mongoose.Schema({ fieldKey: String, readableBy: [String], editableBy: [String] }, { _id: false });
const workflowSchema = new mongoose.Schema({ tenantId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true }, name: { type: String, required: true }, transitions: { type: [transitionSchema], default: [] }, fieldPermissions: { type: [fieldPermissionSchema], default: [] }, approvalEnabled: { type: Boolean, default: false } }, { timestamps: true });
const WorkflowConfig = mongoose.model('WorkflowConfig', workflowSchema);
module.exports = { WorkflowConfig };
