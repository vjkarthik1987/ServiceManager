const mongoose = require('mongoose');

const WORKFLOW_ISSUE_TYPES = ['BUG', 'CR', 'QUERY'];

const transitionSchema = new mongoose.Schema(
  {
    fromStatus: { type: String, required: true, trim: true, uppercase: true },
    toStatus: { type: String, required: true, trim: true, uppercase: true },
    rolesAllowed: { type: [String], default: [] },
    requiresApproval: { type: Boolean, default: false }
  },
  { _id: false }
);

const statusDefinitionSchema = new mongoose.Schema(
  {
    statusKey: { type: String, required: true, trim: true, uppercase: true },
    clientVisible: { type: Boolean, default: false },
    clientBucket: { type: String, trim: true, uppercase: true, default: '' },
    clientLabel: { type: String, trim: true, default: '' }
  },
  { _id: false }
);

const fieldPermissionSchema = new mongoose.Schema(
  {
    fieldKey: { type: String, trim: true },
    readableBy: { type: [String], default: [] },
    editableBy: { type: [String], default: [] }
  },
  { _id: false }
);

const workflowSchema = new mongoose.Schema(
  {
    tenantId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
    issueType: { type: String, enum: WORKFLOW_ISSUE_TYPES, required: true, index: true },
    name: { type: String, required: true, trim: true },
    statuses: { type: [String], default: [] },
    statusDefinitions: { type: [statusDefinitionSchema], default: [] },
    transitions: { type: [transitionSchema], default: [] },
    fieldPermissions: { type: [fieldPermissionSchema], default: [] },
    approvalEnabled: { type: Boolean, default: false }
  },
  { timestamps: true }
);

workflowSchema.index({ tenantId: 1, issueType: 1 }, { unique: true });

const WorkflowConfig = mongoose.model('WorkflowConfig', workflowSchema);

module.exports = { WorkflowConfig, WORKFLOW_ISSUE_TYPES };
