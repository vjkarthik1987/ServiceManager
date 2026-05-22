const router = require('express').Router({ mergeParams: true });
const { adminConsolePage, updateTenantSettings, sendTestEmail, requestTaxonomyPage, updateRequestTaxonomy } = require('./admin-console.controller');

router.get('/', adminConsolePage);
router.post('/settings', updateTenantSettings);
router.post('/email/test', sendTestEmail);
router.get('/request-taxonomy', requestTaxonomyPage);
router.post('/request-taxonomy', updateRequestTaxonomy);

module.exports = router;
