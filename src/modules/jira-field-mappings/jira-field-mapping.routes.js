const router = require('express').Router({ mergeParams: true });
const {
  listJiraFieldMappings,
  newJiraFieldMappingForm,
  saveJiraFieldMapping,
  getResolvedJiraFieldMappings
} = require('./jira-field-mapping.controller');

router.get('/', listJiraFieldMappings);
router.get('/new', newJiraFieldMappingForm);
router.post('/', saveJiraFieldMapping);
router.get('/resolved', getResolvedJiraFieldMappings);

module.exports = router;
