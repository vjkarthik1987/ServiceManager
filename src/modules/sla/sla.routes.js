
const router = require('express').Router({ mergeParams: true });
const { listSlaPoliciesPage, showNewSlaPolicyPage, createSlaPolicy, updateSlaPolicy } = require('./sla.controller');
router.get('/', listSlaPoliciesPage);
router.get('/new', showNewSlaPolicyPage);
router.post('/', createSlaPolicy);
router.put('/:id', updateSlaPolicy);
module.exports = router;
