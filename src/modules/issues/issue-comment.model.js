const mongoose = require('mongoose');
const { fileAttachmentSchema } = require('../storage/file-attachment.schema');

const COMMENT_VISIBILITIES = ['INTERNAL', 'EXTERNAL'];
const COMMENT_AUTHOR_ROLES = ['client_user', 'agent', 'superadmin'];

const issueCommentSchema = new mongoose.Schema(
  {
    tenantId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
    issueId: { type: mongoose.Schema.Types.ObjectId, ref: 'Issue', required: true, index: true },
    entityId: { type: mongoose.Schema.Types.ObjectId, ref: 'Entity', required: true, index: true },
    commentText: { type: String, required: true, trim: true },
    authorUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    authorRole: { type: String, enum: COMMENT_AUTHOR_ROLES, required: true },
    visibility: { type: String, enum: COMMENT_VISIBILITIES, default: 'EXTERNAL', index: true },
    attachments: { type: [fileAttachmentSchema], default: [] }
  },
  { timestamps: true }
);

issueCommentSchema.index({ tenantId: 1, issueId: 1, entityId: 1, createdAt: -1 });
issueCommentSchema.index({ tenantId: 1, entityId: 1, visibility: 1, createdAt: -1 });

const IssueComment = mongoose.model('IssueComment', issueCommentSchema);

module.exports = { IssueComment, COMMENT_VISIBILITIES, COMMENT_AUTHOR_ROLES };
