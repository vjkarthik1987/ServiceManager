const { handleAssistant } = require('./assistant.service');
const { AssistantConversation } = require('./assistant-conversation.model');

const MAX_STORED_MESSAGES = 80;

function normalizeMessageItem(item = {}) {
  return {
    role: item.role,
    text: item.text || '',
    intent: item.intent || '',
    createdAt: item.createdAt || new Date()
  };
}

async function getOrCreateConversation(req) {
  let conversation = await AssistantConversation.findOne({ tenantId: req.tenant._id, userId: req.currentUser._id });
  if (!conversation) {
    conversation = await AssistantConversation.create({ tenantId: req.tenant._id, userId: req.currentUser._id, messages: [], draft: null, context: null });
  }
  return conversation;
}

async function getAssistantHistory(req, res, next) {
  try {
    const conversation = await AssistantConversation.findOne({ tenantId: req.tenant._id, userId: req.currentUser._id }).lean();
    return res.json({
      messages: (conversation?.messages || []).slice(-MAX_STORED_MESSAGES).map(normalizeMessageItem),
      draft: conversation?.draft || null,
      context: conversation?.context || null
    });
  } catch (error) {
    return next(error);
  }
}

async function clearAssistantHistory(req, res, next) {
  try {
    await AssistantConversation.findOneAndUpdate(
      { tenantId: req.tenant._id, userId: req.currentUser._id },
      { $set: { messages: [], draft: null, context: null } },
      { upsert: true }
    );
    return res.json({ ok: true });
  } catch (error) {
    return next(error);
  }
}

async function handleAssistantMessage(req, res, next) {
  try {
    const message = String(req.body?.message || '').trim();
    if (!message) return res.status(400).json({ error: 'Message is required.' });

    const conversation = await getOrCreateConversation(req);
    const draft = req.body?.draft || conversation.draft || null;
    const context = conversation.context || null;
    const result = await handleAssistant({ tenant: req.tenant, user: req.currentUser, message, draft, context });

    conversation.messages.push({ role: 'user', text: message, intent: result.intent || '', createdAt: new Date() });
    conversation.messages.push({ role: 'assistant', text: result.reply || 'Done.', intent: result.intent || '', createdAt: new Date() });
    if (conversation.messages.length > MAX_STORED_MESSAGES) {
      conversation.messages = conversation.messages.slice(-MAX_STORED_MESSAGES);
    }
    conversation.draft = result.draft || null;
    if (Object.prototype.hasOwnProperty.call(result, 'context')) {
      conversation.context = result.context || null;
    }
    await conversation.save();

    return res.json(result);
  } catch (error) {
    const status = error.status || 500;
    return res.status(status).json({ error: error.message || 'Assistant request failed.' });
  }
}

module.exports = { handleAssistantMessage, getAssistantHistory, clearAssistantHistory };
