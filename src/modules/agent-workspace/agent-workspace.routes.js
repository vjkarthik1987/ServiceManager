
const router = require('express').Router({ mergeParams: true });
const { workspacePage } = require('./agent-workspace.controller');
router.get('/', workspacePage);
module.exports = router;
