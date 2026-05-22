
const router = require('express').Router({ mergeParams: true });
const { showAssignAgent, createAssignment, removeAssignment } = require('./assignment.controller');
router.get('/new', showAssignAgent);
router.post('/agent', createAssignment);
router.post('/:membershipId/remove', removeAssignment);
module.exports = router;
