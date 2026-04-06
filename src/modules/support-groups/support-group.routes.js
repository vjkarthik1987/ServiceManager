const router = require('express').Router({ mergeParams: true });
const { listSupportGroups, createSupportGroup } = require('./support-group.controller');
router.get('/', listSupportGroups);
router.post('/', createSupportGroup);
module.exports = router;
