const router = require('express').Router({ mergeParams: true });
const { listStatusMappingsPage, createStatusMapping } = require('./status-mapping.controller');

router.get('/', listStatusMappingsPage);
router.post('/', createStatusMapping);

module.exports = router;
