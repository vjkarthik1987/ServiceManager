const router = require('express').Router({ mergeParams: true });
const { listModules, showNewModule, createModule, showEditModule, updateModule, toggleModuleStatus } = require('./module.controller');
router.get('/', listModules);
router.get('/new', showNewModule);
router.post('/', createModule);
router.get('/:id/edit', showEditModule);
router.post('/:id/edit', updateModule);
router.post('/:id/status', toggleModuleStatus);
module.exports = router;
