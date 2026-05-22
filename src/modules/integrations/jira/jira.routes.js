const router = require('express').Router({ mergeParams: true });
const { getJiraConnection, saveJiraConnection, validateJiraConnection } = require('./jira-connection.controller');
const { receiveJiraWebhook } = require('./jira-webhook.controller');

router.get('/', getJiraConnection);
router.put('/', saveJiraConnection);
router.post('/', saveJiraConnection);
router.post('/validate', validateJiraConnection);
router.post('/webhook', receiveJiraWebhook);

module.exports = router;
