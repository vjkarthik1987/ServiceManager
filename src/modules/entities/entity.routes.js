const router = require('express').Router({ mergeParams: true });
const {
  listEntities,
  showCreateEntity,
  createEntity,
  showEntityDetail,
  showEditEntity,
  updateEntity,
  changeEntityStatus,
  deleteEntity,
  exportEntitiesExcel,
  getEntityJiraConfigApi,
  saveEntityJiraConfigApi,
  getEffectiveJiraConfigApi,
  syncEntityJiraMetadataApi,
  getEntityJiraRequiredFieldsApi
} = require('./entity.controller');
const { showEntityUsers, showEntityAgents } = require('../users/user.controller');
const { requireRole } = require('../../middleware/auth');

router.get('/', listEntities);
router.get('/export', exportEntitiesExcel);
router.get('/new', showCreateEntity);
router.post('/', createEntity);
router.get('/:id', showEntityDetail);
router.get('/:id/edit', requireRole(['superadmin']), showEditEntity);
router.post('/:id/edit', requireRole(['superadmin']), updateEntity);
router.post('/:id', requireRole(['superadmin']), updateEntity);
router.put('/:id', requireRole(['superadmin']), updateEntity);
router.post('/:id/status', requireRole(['superadmin']), changeEntityStatus);
router.delete('/:id', requireRole(['superadmin']), deleteEntity);
router.get('/:id/users', showEntityUsers);
router.get('/:id/agents', showEntityAgents);
router.get('/:id/jira-config', requireRole(['superadmin']), getEntityJiraConfigApi);
router.put('/:id/jira-config', requireRole(['superadmin']), saveEntityJiraConfigApi);
router.get('/:id/effective-jira-config', getEffectiveJiraConfigApi);
router.post('/:id/jira-config/sync-metadata', requireRole(['superadmin']), syncEntityJiraMetadataApi);
router.get('/:id/jira-required-fields', getEntityJiraRequiredFieldsApi);

module.exports = router;
