
const router = require('express').Router({ mergeParams: true });
const { getTenant } = require('./tenant.controller');
router.get('/', getTenant);
module.exports = router;
