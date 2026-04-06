const { Entity } = require('../entities/entity.model');
const { EntityJiraFieldMetadata } = require('../entities/entity-jira-metadata.model');
const { logAudit } = require('../audit/audit.service');
const { JiraFieldMapping, SOURCE_TYPES, APPLY_MODES, TRANSFORMS } = require('./jira-field-mapping.model');
const { serializeMapping, listMappingsForContext, upsertFieldMapping } = require('./jira-field-mapping.service');

function isApiRequest(req) {
  return req.originalUrl.startsWith('/api/');
}

function badRequest(message) {
  const error = new Error(message);
  error.status = 400;
  return error;
}

async function getCreateFormData(tenantId) {
  const [entities, metadataRows] = await Promise.all([
    Entity.find({ tenantId, isActive: true }).sort({ path: 1 }).lean(),
    EntityJiraFieldMetadata.find({ tenantId }).sort({ projectKey: 1, issueTypeName: 1 }).lean()
  ]);
  return { entities, metadataRows };
}

async function listJiraFieldMappings(req, res, next) {
  try {
    const filter = { tenantId: req.tenant._id };
    if (req.query.projectKey) filter.projectKey = String(req.query.projectKey).trim().toUpperCase();
    if (req.query.issueTypeId) filter.issueTypeId = String(req.query.issueTypeId).trim();
    if (req.query.entityId === 'global') filter.entityId = null;
    else if (req.query.entityId) filter.entityId = req.query.entityId;

    const rows = await JiraFieldMapping.find(filter).populate('entityId', 'name path').sort({ projectKey: 1, issueTypeName: 1, sortOrder: 1, fieldName: 1, fieldId: 1 });
    if (isApiRequest(req)) return res.json({ items: rows.map(serializeMapping) });
    return res.render('jira-field-mappings/index', { title: 'Jira Field Mapping', items: rows.map(serializeMapping) });
  } catch (error) {
    return next(error);
  }
}

async function newJiraFieldMappingForm(req, res, next) {
  try {
    const { entities, metadataRows } = await getCreateFormData(req.tenant._id);
    return res.render('jira-field-mappings/new', {
      title: 'Create Jira Field Mapping',
      entities,
      metadataRows,
      defaults: {
        entityId: req.query.entityId || 'global',
        projectKey: req.query.projectKey || '',
        issueTypeId: req.query.issueTypeId || '',
        issueTypeName: req.query.issueTypeName || '',
        sourceType: 'STATIC',
        transform: 'NONE',
        applyMode: 'DEFAULT_ONLY',
        sortOrder: 100,
        fieldId: '',
        fieldName: '',
        sourcePath: '',
        staticValue: '',
        helpText: ''
      },
      enums: { SOURCE_TYPES, APPLY_MODES, TRANSFORMS }
    });
  } catch (error) {
    return next(error);
  }
}

async function saveJiraFieldMapping(req, res, next) {
  try {
    const projectKey = String(req.body.projectKey || '').trim().toUpperCase();
    const issueTypeId = String(req.body.issueTypeId || '').trim();
    const fieldId = String(req.body.fieldId || '').trim();
    if (!projectKey) throw badRequest('projectKey is required.');
    if (!issueTypeId) throw badRequest('issueTypeId is required.');
    if (!fieldId) throw badRequest('fieldId is required.');

    const entityId = req.body.entityId && req.body.entityId !== 'global' ? req.body.entityId : null;
    const mapping = await upsertFieldMapping({
      tenantId: req.tenant._id,
      entityId,
      actorUserId: req.currentUser._id,
      payload: req.body
    });

    await logAudit({
      tenantId: req.tenant._id,
      actorUserId: req.currentUser._id,
      action: 'jira.field_mapping.saved',
      entityType: 'jira_field_mapping',
      entityId: mapping._id,
      after: serializeMapping(mapping)
    });

    if (isApiRequest(req)) return res.status(201).json({ item: serializeMapping(mapping) });
    req.session.success = 'Jira field mapping saved.';
    return res.redirect(`${req.basePath}/admin/jira-field-mappings`);
  } catch (error) {
    if (isApiRequest(req) && error.status) return res.status(error.status).json({ error: error.message });
    return next(error);
  }
}

async function getResolvedJiraFieldMappings(req, res, next) {
  try {
    const projectKey = String(req.query.projectKey || '').trim().toUpperCase();
    const issueTypeId = String(req.query.issueTypeId || '').trim();
    const entityId = req.query.entityId || null;
    if (!projectKey || !issueTypeId) throw badRequest('projectKey and issueTypeId are required.');
    const items = await listMappingsForContext({ tenantId: req.tenant._id, entityId, projectKey, issueTypeId });
    return res.json({ items: items.map(serializeMapping) });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    return next(error);
  }
}

module.exports = {
  listJiraFieldMappings,
  newJiraFieldMappingForm,
  saveJiraFieldMapping,
  getResolvedJiraFieldMappings
};
