const router = require('express').Router({ mergeParams: true });
const { listRoutingRules, createRoutingRule, updateRoutingRule } = require('./routing.controller');
router.get('/', listRoutingRules);
router.post('/', createRoutingRule);
router.put('/:id', updateRoutingRule);
module.exports = router;
