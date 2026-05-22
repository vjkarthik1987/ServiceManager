const router = require('express').Router({ mergeParams: true });
const { requireAuth } = require('../../middleware/auth');
const { handleAssistantMessage, getAssistantHistory, clearAssistantHistory } = require('./assistant.controller');

router.get('/history', requireAuth, getAssistantHistory);
router.delete('/history', requireAuth, clearAssistantHistory);
router.post('/message', requireAuth, handleAssistantMessage);

module.exports = router;
