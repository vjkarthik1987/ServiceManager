const mongoose = require('mongoose');

const assistantConversationSchema = new mongoose.Schema(
  {
    tenantId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
    userId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
    messages: {
      type: [
        {
          role: { type: String, enum: ['user', 'assistant'], required: true },
          text: { type: String, default: '' },
          intent: { type: String, default: '' },
          createdAt: { type: Date, default: Date.now }
        }
      ],
      default: []
    },
    draft: { type: mongoose.Schema.Types.Mixed, default: null },
    context: { type: mongoose.Schema.Types.Mixed, default: null }
  },
  { timestamps: true }
);

assistantConversationSchema.index({ tenantId: 1, userId: 1 }, { unique: true });

const AssistantConversation = mongoose.model('AssistantConversation', assistantConversationSchema);

module.exports = { AssistantConversation };
