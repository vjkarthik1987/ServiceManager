const { Entity } = require('./entity.model');
const { Product } = require('../products/product.model');
const { SlaPolicy } = require('../sla/sla-policy.model');
const {
  createEntityForTenant,
  listEntitiesForTenant,
  getEntityForTenant,
  updateEntityForTenant,
  setEntityActiveState,
  deleteEntityForTenant,
  updateEntityJiraConfig,
  resolveEffectiveEntityJiraConfig,
  normalizeBoolean
} = require('./entity.service');
const { EntityJiraFieldMetadata } = require('./entity-jira-metadata.model');
const { logAudit } = require('../audit/audit.service');
const { getPagination, buildPager, buildQueryString } = require('../../utils/pagination');
const { rowsToExcelXml, sendExcelXml } = require('../../utils/export');

const AUTO_MAPPED_JIRA_FIELDS = new Set(['summary', 'description', 'priority', 'labels', 'project', 'issuetype']);
const { sanitizeMetadataFields } = require('../integrations/jira/jira-field-utils');
const { getAccessibleEntityIdsForUser, userHasEntityAccess } = require('../../utils/access');
const { UserEntityMembership } = require('../memberships/membership.model');
const { getTenantJiraConnection } = require('../integrations/jira/jira-connection.service');
const { listJiraProjects, listJiraIssueTypesForProject, getCreateFieldMetadata } = require('../integrations/jira/jira-metadata.service');

function isApiRequest(req) {
  return req.originalUrl.startsWith('/api/');
}

function buildJiraConfigFromBody(body = {}, type = 'client') {
  return {
    isEnabled: normalizeBoolean(body.jiraEnabled || body['jiraConfig.isEnabled'] || body.isEnabled, false),
    projectKey: body.jiraProjectKey || body['jiraConfig.projectKey'] || body.projectKey || '',
    projectId: body.jiraProjectId || body['jiraConfig.projectId'] || body.projectId || '',
    issueTypeId: body.jiraIssueTypeId || body['jiraConfig.issueTypeId'] || body.issueTypeId || '',
    issueTypeName: body.jiraIssueTypeName || body['jiraConfig.issueTypeName'] || body.issueTypeName || '',
    autoPushOnCreate: normalizeBoolean(body.jiraAutoPushOnCreate || body['jiraConfig.autoPushOnCreate'] || body.autoPushOnCreate, false),
    inheritFromParent: type === 'subclient' ? normalizeBoolean(body.jiraInheritFromParent || body['jiraConfig.inheritFromParent'] || body.inheritFromParent, true) : false
  };
}

function serializeJiraConfig(entity) {
  return {
    isEnabled: !!entity?.jiraConfig?.isEnabled,
    projectKey: entity?.jiraConfig?.projectKey || '',
    projectId: entity?.jiraConfig?.projectId || '',
    issueTypeId: entity?.jiraConfig?.issueTypeId || '',
    issueTypeName: entity?.jiraConfig?.issueTypeName || '',
    autoPushOnCreate: !!entity?.jiraConfig?.autoPushOnCreate,
    inheritFromParent: !!entity?.jiraConfig?.inheritFromParent,
    lastMetadataSyncAt: entity?.jiraConfig?.lastMetadataSyncAt || null
  };
}


function parseSelectedValues(input) {
  if (Array.isArray(input)) return input.map((item) => String(item).trim()).filter(Boolean);
  return String(input || '').split(',').map((item) => item.trim()).filter(Boolean);
}
function buildCommitmentDefaultsFromBody(body = {}, type = 'client') {
  return {
    inheritFromParent: type === 'subclient' ? normalizeBoolean(body.inheritCommitments || body['commitmentDefaults.inheritFromParent'], true) : false,
    slaPolicyId: body.defaultSlaPolicyId || body['commitmentDefaults.slaPolicyId'] || null,
    olaPolicyId: body.defaultOlaPolicyId || body['commitmentDefaults.olaPolicyId'] || null
  };
}

function entityJson(entity) {
  return {
    id: entity._id,
    name: entity.name,
    type: entity.type,
    acronym: entity.acronym || '',
    parentId: entity.parentId?._id || entity.parentId || null,
    path: entity.path,
    metadata: entity.metadata,
    commitmentDefaults: entity.commitmentDefaults || { inheritFromParent: true, slaPolicyId: null, olaPolicyId: null },
    jiraConfig: serializeJiraConfig(entity),
    isActive: entity.isActive,
    createdAt: entity.createdAt,
    updatedAt: entity.updatedAt
  };
}

async function listEntities(req, res, next) {
  try {
    let entities = await listEntitiesForTenant(req.tenant._id);
    if (req.currentUser.role !== 'superadmin') {
      const allowed = await getAccessibleEntityIdsForUser(req.currentUser);
      entities = entities.filter((entity) => allowed.includes(String(entity._id)));
    }
    const filters = { q: req.query.q || '', type: req.query.type || '' };
    if (filters.q) {
      const q = filters.q.toLowerCase();
      entities = entities.filter((entity) => [entity.name, entity.path, entity.metadata?.region, entity.metadata?.product].filter(Boolean).join(' ').toLowerCase().includes(q));
    }
    if (filters.type) entities = entities.filter((entity) => entity.type === filters.type);
    const grouped = entities.filter((entity) => entity.type === 'client').map((client) => ({ client, children: entities.filter((entity) => String(entity.parentId?._id || entity.parentId || '') === String(client._id)) }));
    const { page, pageSize, skip } = getPagination(req.query, 10);
    const totalItems = entities.length;
    const paged = entities.slice(skip, skip + pageSize);
    const pager = buildPager({ totalItems, page, pageSize });
    return res.render('entities/list', { title: 'Entities', entities: paged, groupedEntities: grouped, filters, pager, buildQueryString });
  } catch (error) { return next(error); }
}

async function showCreateEntity(req, res, next) {
  try {
    let parents = await Entity.find({ tenantId: req.tenant._id, isActive: true }).sort({ path: 1 });
    const products = await Product.find({ tenantId: req.tenant._id, isActive: true }).sort({ name: 1 }).lean();
    const policies = await SlaPolicy.find({ tenantId: req.tenant._id, isActive: true }).sort({ agreementType: 1, name: 1 }).lean();
    let defaults = { type: req.currentUser.role === 'client' ? 'subclient' : (req.query.type || 'client'), parentId: req.query.parentId || '', name: '', acronym: '', region: '', product: '', productIds: [], defaultSlaPolicyId: '', defaultOlaPolicyId: '', inheritCommitments: true, jiraEnabled: false, jiraProjectKey: '', jiraProjectId: '', jiraIssueTypeId: '', jiraIssueTypeName: '', jiraAutoPushOnCreate: false, jiraInheritFromParent: true };
    if (req.currentUser.role === 'client') {
      const allowed = await getAccessibleEntityIdsForUser(req.currentUser);
      parents = parents.filter((entity) => allowed.includes(String(entity._id)));
    }
    let jiraProjects = [];
    if (req.currentUser.role === 'superadmin') {
      const connection = await getTenantJiraConnection({ tenantId: req.tenant._id, includeSecret: true });
      if (connection?.isActive) {
        try { jiraProjects = await listJiraProjects(connection); } catch (error) { jiraProjects = []; }
      }
    }
    return res.render('entities/new', { title: 'Create Client / Subclient', formMode: 'create', formAction: `${req.basePath}/entities`, formMethod: 'POST', methodOverride: null, parents, defaults, jiraProjects, products, policies, entity: null });
  } catch (error) {
    return next(error);
  }
}

async function createEntity(req, res, next) {
  try {
    const { name, acronym, type, parentId, region, product } = req.body;

    if (!['superadmin', 'client'].includes(req.currentUser.role)) {
      req.session.error = 'You do not have access to create entities.';
      return res.redirect(`${req.basePath}/entities`);
    }

    if (req.currentUser.role === 'client') {
      if (type !== 'subclient') {
        req.session.error = 'Client users can only create subclients.';
        return res.redirect(`${req.basePath}/entities/new`);
      }
      if (!(await userHasEntityAccess(req.currentUser, parentId))) {
        req.session.error = 'You do not have access to the selected parent entity.';
        return res.redirect(`${req.basePath}/entities/new`);
      }
    }

    const entity = await createEntityForTenant({
      tenantId: req.tenant._id,
      name,
      acronym,
      type,
      parentId: parentId || null,
      metadata: { region, product, productIds: parseSelectedValues(req.body.productIds) },
      commitmentDefaults: buildCommitmentDefaultsFromBody(req.body, type),
      jiraConfig: req.currentUser.role === 'superadmin' ? buildJiraConfigFromBody(req.body, type) : {}
    });

    await logAudit({
      tenantId: req.tenant._id,
      actorUserId: req.currentUser._id,
      action: 'entity.created',
      entityType: 'entity',
      entityId: entity._id,
      after: { name: entity.name, acronym: entity.acronym, type: entity.type, path: entity.path, jiraConfig: serializeJiraConfig(entity) }
    });

    if (req.currentUser.role === 'client') {
      await UserEntityMembership.updateOne(
        { tenantId: req.tenant._id, userId: req.currentUser._id, entityId: entity._id },
        { $set: { status: 'active', isPrimary: false } },
        { upsert: true }
      );
    }

    req.session.success = 'Entity created successfully.';
    return res.redirect(`${req.basePath}/entities`);
  } catch (error) {
    if (error.status && error.status < 500) {
      req.session.error = error.message;
      return res.redirect(`${req.basePath}/entities/new`);
    }
    return next(error);
  }
}


async function showEditEntity(req, res, next) {
  try {
    const entity = await getEntityForTenant({ tenantId: req.tenant._id, entityId: req.params.id });
    if (!entity) {
      req.session.error = 'Entity not found.';
      return res.redirect(`${req.basePath}/entities`);
    }
    let parents = await Entity.find({ tenantId: req.tenant._id, isActive: true, _id: { $ne: entity._id } }).sort({ path: 1 });
    parents = parents.filter((item) => item.type === 'client');
    const products = await Product.find({ tenantId: req.tenant._id, isActive: true }).sort({ name: 1 }).lean();
    const policies = await SlaPolicy.find({ tenantId: req.tenant._id, isActive: true }).sort({ agreementType: 1, name: 1 }).lean();
    let jiraProjects = [];
    if (req.currentUser.role === 'superadmin') {
      const connection = await getTenantJiraConnection({ tenantId: req.tenant._id, includeSecret: true });
      if (connection?.isActive) {
        try { jiraProjects = await listJiraProjects(connection); } catch (error) { jiraProjects = []; }
      }
    }
    const defaults = {
      type: entity.type,
      parentId: entity.parentId?._id ? String(entity.parentId._id) : String(entity.parentId || ''),
      name: entity.name,
      acronym: entity.acronym || '',
      region: entity.metadata?.region || '',
      product: entity.metadata?.product || '',
      productIds: (entity.metadata?.productIds || []).map((item) => String(item)),
      defaultSlaPolicyId: entity.commitmentDefaults?.slaPolicyId ? String(entity.commitmentDefaults.slaPolicyId) : '',
      defaultOlaPolicyId: entity.commitmentDefaults?.olaPolicyId ? String(entity.commitmentDefaults.olaPolicyId) : '',
      inheritCommitments: entity.commitmentDefaults?.inheritFromParent !== false,
      jiraEnabled: !!entity.jiraConfig?.isEnabled,
      jiraProjectKey: entity.jiraConfig?.projectKey || '',
      jiraProjectId: entity.jiraConfig?.projectId || '',
      jiraIssueTypeId: entity.jiraConfig?.issueTypeId || '',
      jiraIssueTypeName: entity.jiraConfig?.issueTypeName || '',
      jiraAutoPushOnCreate: !!entity.jiraConfig?.autoPushOnCreate,
      jiraInheritFromParent: !!entity.jiraConfig?.inheritFromParent
    };
    return res.render('entities/new', { title: `Edit ${entity.name}`, formMode: 'edit', formAction: `${req.basePath}/entities/${entity._id}/edit`, formMethod: 'POST', methodOverride: null, parents, defaults, jiraProjects, products, policies, entity });
  } catch (error) { return next(error); }
}


async function showEntityDetail(req, res, next) {
  try {
    const entity = await getEntityForTenant({ tenantId: req.tenant._id, entityId: req.params.id });
    if (!entity) {
      req.session.error = 'Entity not found.';
      return res.redirect(`${req.basePath}/entities`);
    }
    if (req.currentUser.role !== 'superadmin' && !(await userHasEntityAccess(req.currentUser, entity._id))) {
      req.session.error = 'You do not have access to this entity.';
      return res.redirect(`${req.basePath}/entities`);
    }
    const children = await Entity.find({ tenantId: req.tenant._id, parentId: entity._id }).sort({ path: 1 }).lean();
    return res.render('entities/detail', { title: entity.name, entity, children });
  } catch (error) {
    return next(error);
  }
}

async function updateEntity(req, res, next) {
  try {
    const entity = await updateEntityForTenant({
      tenantId: req.tenant._id,
      entityId: req.params.id,
      updates: {
        name: req.body.name,
        acronym: req.body.acronym,
        type: req.body.type,
        parentId: req.body.parentId || null,
        region: req.body.region,
        product: req.body.product,
        productIds: parseSelectedValues(req.body.productIds),
        commitmentDefaults: buildCommitmentDefaultsFromBody(req.body, req.body.type),
        jiraConfig: req.currentUser.role === 'superadmin' ? buildJiraConfigFromBody(req.body, req.body.type) : undefined
      }
    });
    await logAudit({ tenantId: req.tenant._id, actorUserId: req.currentUser._id, action: 'entity.updated', entityType: 'entity', entityId: entity._id, after: entityJson(entity) });
    if (isApiRequest(req)) return res.json({ item: entityJson(entity) });
    req.session.success = 'Entity updated successfully.';
    return res.redirect(`${req.basePath}/entities`);
  } catch (error) {
    if (isApiRequest(req) && error.status) return res.status(error.status).json({ error: error.message });
    if (error.status) { req.session.error = error.message; return res.redirect(`${req.basePath}/entities/${req.params.id}/edit`); }
    return next(error);
  }
}

async function changeEntityStatus(req, res, next) {
  try {
    const entity = await setEntityActiveState({ tenantId: req.tenant._id, entityId: req.params.id, isActive: String(req.body.isActive) === 'true' || req.body.action === 'activate' });
    await logAudit({ tenantId: req.tenant._id, actorUserId: req.currentUser._id, action: entity.isActive ? 'entity.activated' : 'entity.deactivated', entityType: 'entity', entityId: entity._id, after: { isActive: entity.isActive } });
    if (isApiRequest(req)) return res.json({ item: entityJson(entity) });
    req.session.success = entity.isActive ? 'Entity activated.' : 'Entity deactivated.';
    return res.redirect(`${req.basePath}/entities`);
  } catch (error) { if (isApiRequest(req) && error.status) return res.status(error.status).json({ error: error.message }); return next(error); }
}

async function deleteEntity(req, res, next) {
  try {
    const entity = await deleteEntityForTenant({ tenantId: req.tenant._id, entityId: req.params.id });
    await logAudit({ tenantId: req.tenant._id, actorUserId: req.currentUser._id, action: 'entity.deleted', entityType: 'entity', entityId: entity._id, after: { name: entity.name, path: entity.path } });
    if (isApiRequest(req)) return res.json({ ok: true });
    req.session.success = 'Entity deleted.';
    return res.redirect(`${req.basePath}/entities`);
  } catch (error) { if (isApiRequest(req) && error.status) return res.status(error.status).json({ error: error.message }); if (error.status) { req.session.error = error.message; return res.redirect(`${req.basePath}/entities`); } return next(error); }
}

async function listEntitiesApi(req, res, next) {
  try {
    let entities = await listEntitiesForTenant(req.tenant._id);
    if (req.currentUser.role !== 'superadmin') {
      const allowed = await getAccessibleEntityIdsForUser(req.currentUser);
      entities = entities.filter((entity) => allowed.includes(String(entity._id)));
    }
    return res.json({
      items: entities.map(entityJson)
    });
  } catch (error) {
    return next(error);
  }
}

async function createEntityApi(req, res, next) {
  try {
    const { name, type, parentId, metadata = {}, region, product } = req.body;
    if (!['superadmin', 'client'].includes(req.currentUser.role)) {
      return res.status(403).json({ error: 'You do not have access to create entities.' });
    }
    if (req.currentUser.role === 'client') {
      if (type !== 'subclient') return res.status(403).json({ error: 'Client users can only create subclients.' });
      if (!(await userHasEntityAccess(req.currentUser, parentId))) {
        return res.status(403).json({ error: 'You do not have access to the selected parent entity.' });
      }
    }
    const mergedMetadata = {
      region: metadata.region || region || '',
      product: metadata.product || product || '',
      productIds: metadata.productIds || parseSelectedValues(req.body.productIds)
    };

    const entity = await createEntityForTenant({
      tenantId: req.tenant._id,
      name,
      acronym,
      type,
      parentId: parentId || null,
      metadata: mergedMetadata,
      commitmentDefaults: buildCommitmentDefaultsFromBody(req.body, type),
      jiraConfig: req.currentUser.role === 'superadmin' ? (req.body.jiraConfig || buildJiraConfigFromBody(req.body, type)) : {}
    });

    await logAudit({
      tenantId: req.tenant._id,
      actorUserId: req.currentUser._id,
      action: 'entity.created',
      entityType: 'entity',
      entityId: entity._id,
      after: { name: entity.name, acronym: entity.acronym, type: entity.type, path: entity.path, jiraConfig: serializeJiraConfig(entity) }
    });

    if (req.currentUser.role === 'client') {
      await UserEntityMembership.updateOne(
        { tenantId: req.tenant._id, userId: req.currentUser._id, entityId: entity._id },
        { $set: { status: 'active', isPrimary: false } },
        { upsert: true }
      );
    }

    return res.status(201).json({
      item: entityJson(entity)
    });
  } catch (error) {
    return next(error);
  }
}

async function getEntityJiraConfigApi(req, res, next) {
  try {
    const entity = await getEntityForTenant({ tenantId: req.tenant._id, entityId: req.params.id });
    if (!entity) return res.status(404).json({ error: 'Entity not found.' });
    return res.json({ item: { entityId: entity._id, jiraConfig: serializeJiraConfig(entity) } });
  } catch (error) { return next(error); }
}

async function saveEntityJiraConfigApi(req, res, next) {
  try {
    const entity = await updateEntityJiraConfig({
      tenantId: req.tenant._id,
      entityId: req.params.id,
      jiraConfig: req.body.jiraConfig || buildJiraConfigFromBody(req.body)
    });
    await logAudit({
      tenantId: req.tenant._id,
      actorUserId: req.currentUser._id,
      action: 'entity.jira_mapping.saved',
      entityType: 'entity',
      entityId: entity._id,
      after: { jiraConfig: serializeJiraConfig(entity) }
    });
    return res.json({ item: { entityId: entity._id, jiraConfig: serializeJiraConfig(entity) } });
  } catch (error) { return next(error); }
}

async function getEffectiveJiraConfigApi(req, res, next) {
  try {
    if (!(await userHasEntityAccess(req.currentUser, req.params.id)) && req.currentUser.role !== 'superadmin') {
      return res.status(403).json({ error: 'You do not have access to this entity.' });
    }
    const resolved = await resolveEffectiveEntityJiraConfig({ tenantId: req.tenant._id, entityId: req.params.id });
    return res.json({ item: { source: resolved.source, entityId: resolved.entity?._id || null, jiraConfig: resolved.config } });
  } catch (error) { return next(error); }
}

async function syncEntityJiraMetadataApi(req, res, next) {
  try {
    const resolved = await resolveEffectiveEntityJiraConfig({ tenantId: req.tenant._id, entityId: req.params.id });
    if (!resolved.config) return res.status(400).json({ error: 'No Jira mapping is configured for this entity.' });
    const connection = await getTenantJiraConnection({ tenantId: req.tenant._id, includeSecret: true });
    if (!connection || !connection.isActive) return res.status(400).json({ error: 'Active Jira connection is required.' });

    const metadata = await getCreateFieldMetadata(connection, resolved.config.projectKey, resolved.config.issueTypeId, resolved.config.issueTypeName);
    await EntityJiraFieldMetadata.findOneAndUpdate(
      { tenantId: req.tenant._id, entityId: req.params.id, projectKey: metadata.projectKey, issueTypeId: metadata.issueTypeId },
      {
        $set: {
          issueTypeName: metadata.issueTypeName,
          fields: metadata.fields,
          source: metadata.source,
          lastSyncedAt: new Date()
        }
      },
      { upsert: true, new: true }
    );

    await Entity.updateOne({ _id: req.params.id, tenantId: req.tenant._id }, { $set: { 'jiraConfig.lastMetadataSyncAt': new Date() } });

    await logAudit({
      tenantId: req.tenant._id,
      actorUserId: req.currentUser._id,
      action: 'entity.jira_metadata.synced',
      entityType: 'entity',
      entityId: req.params.id,
      after: { projectKey: metadata.projectKey, issueTypeId: metadata.issueTypeId, issueTypeName: metadata.issueTypeName, fieldsCount: metadata.fields.length }
    });

    return res.json({ item: metadata });
  } catch (error) { return next(error); }
}

async function getEntityJiraRequiredFieldsApi(req, res, next) {
  try {
    if (!(await userHasEntityAccess(req.currentUser, req.params.id)) && req.currentUser.role !== 'superadmin') {
      return res.status(403).json({ error: 'You do not have access to this entity.' });
    }
    const resolved = await resolveEffectiveEntityJiraConfig({ tenantId: req.tenant._id, entityId: req.params.id });
    if (!resolved.config) {
      return res.json({ item: { source: 'NONE', jiraConfig: null, fields: [] } });
    }
    let cached = await EntityJiraFieldMetadata.findOne({
      tenantId: req.tenant._id,
      entityId: req.params.id,
      projectKey: resolved.config.projectKey,
      issueTypeId: resolved.config.issueTypeId
    }).lean();

    if (!cached) {
      const connection = await getTenantJiraConnection({ tenantId: req.tenant._id, includeSecret: true });
      if (connection?.isActive) {
        const live = await getCreateFieldMetadata(connection, resolved.config.projectKey, resolved.config.issueTypeId, resolved.config.issueTypeName);
        cached = await EntityJiraFieldMetadata.findOneAndUpdate(
          { tenantId: req.tenant._id, entityId: req.params.id, projectKey: live.projectKey, issueTypeId: live.issueTypeId },
          { $set: { issueTypeName: live.issueTypeName, fields: live.fields, source: live.source, lastSyncedAt: new Date() } },
          { upsert: true, new: true, lean: true }
        );
      }
    }

    const requiredFields = sanitizeMetadataFields(cached?.fields || []).filter((field) => field.required && !AUTO_MAPPED_JIRA_FIELDS.has(String(field.fieldId || '').toLowerCase()));
    return res.json({
      item: {
        source: resolved.source,
        jiraConfig: resolved.config,
        fields: requiredFields,
        totalRequiredFields: requiredFields.length,
        lastSyncedAt: cached?.lastSyncedAt || null,
        intakeMode: 'ZERO_MAPPING_REQUIRED_ONLY'
      }
    });
  } catch (error) { return next(error); }
}

async function listJiraProjectsApi(req, res, next) {
  try {
    const connection = await getTenantJiraConnection({ tenantId: req.tenant._id, includeSecret: true });
    if (!connection || !connection.isActive) return res.status(400).json({ error: 'Active Jira connection is required.' });
    return res.json({ items: await listJiraProjects(connection) });
  } catch (error) { return next(error); }
}

async function listJiraIssueTypesApi(req, res, next) {
  try {
    const connection = await getTenantJiraConnection({ tenantId: req.tenant._id, includeSecret: true });
    if (!connection || !connection.isActive) return res.status(400).json({ error: 'Active Jira connection is required.' });
    return res.json({ items: await listJiraIssueTypesForProject(connection, req.params.projectKey) });
  } catch (error) { return next(error); }
}

async function exportEntitiesExcel(req, res, next) {
  try {
    let entities = await listEntitiesForTenant(req.tenant._id);
    if (req.currentUser.role !== 'superadmin') {
      const allowed = await getAccessibleEntityIdsForUser(req.currentUser);
      entities = entities.filter((entity) => allowed.includes(String(entity._id)));
    }
    const xml = rowsToExcelXml({
      worksheetName: 'Entities',
      headers: ['Name', 'Type', 'Path', 'Region', 'Products', 'SLA Policy', 'OLA Policy', 'Jira Enabled', 'Jira Project', 'Jira Work Type'],
      rows: entities.map((entity) => [entity.name, entity.type, entity.path, entity.metadata?.region || '', (entity.metadata?.productIds || []).length ? (entity.metadata.productIds || []).join(',') : (entity.metadata?.product || ''), entity.commitmentDefaults?.slaPolicyId || '', entity.commitmentDefaults?.olaPolicyId || '', entity.jiraConfig?.isEnabled ? 'Yes' : 'No', entity.jiraConfig?.projectKey || '', entity.jiraConfig?.issueTypeName || ''])
    });
    return sendExcelXml(res, `entities-${req.tenant.slug}.xls`, xml);
  } catch (error) { return next(error); }
}

module.exports = {
  listEntities,
  showCreateEntity,
  createEntity,
  showEntityDetail,
  showEditEntity,
  updateEntity,
  changeEntityStatus,
  deleteEntity,
  listEntitiesApi,
  createEntityApi,
  getEntityJiraConfigApi,
  saveEntityJiraConfigApi,
  getEffectiveJiraConfigApi,
  syncEntityJiraMetadataApi,
  getEntityJiraRequiredFieldsApi,
  listJiraProjectsApi,
  listJiraIssueTypesApi,
  exportEntitiesExcel
};
