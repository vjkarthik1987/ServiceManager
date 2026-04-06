
const router = require('express').Router({ mergeParams: true });
const { showAssignAgent, createAssignment } = require('./assignment.controller');
router.get('/new', showAssignAgent);
router.post('/agent', createAssignment);
module.exports = router;
