const router = require('express').Router({ mergeParams: true });
const { testConnection, getSharePointConfig } = require('./sharepoint.controller');

router.get('/config', getSharePointConfig);
router.post('/test', testConnection);

module.exports = router;
