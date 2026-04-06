const router = require('express').Router({ mergeParams: true });
const { adminConsolePage, updateTenantSettings } = require('./admin-console.controller');

router.get('/', adminConsolePage);
router.post('/settings', updateTenantSettings);

module.exports = router;
