const mongoose = require('mongoose');
const { Entity } = require('./entity.model');

function sanitizeName(name = '') {
  return String(name).trim().replace(/\s+/g, ' ');
}


function sanitizeAcronym(acronym = '') {
  return String(acronym || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
}

function buildAcronymCandidate(name = '') {
  const clean = sanitizeName(name).toUpperCase().replace(/[^A-Z0-9 ]/g, ' ');
  const words = clean.split(/\s+/).filter(Boolean);
  if (words.length >= 4) return words.slice(0, 4).map((part) => part[0]).join('');
  const compact = words.join('') || clean.replace(/\s+/g, '');
  return compact.slice(0, 4).padEnd(4, 'X');
}

async function resolveUniqueAcronym({ tenantId, name, requestedAcronym = '', excludeEntityId = null }) {
  const base = sanitizeAcronym(requestedAcronym) || buildAcronymCandidate(name);
  if (!base || base.length !== 4) {
    const err = new Error('A unique four-letter acronym is required for every entity and subentity.');
    err.status = 400;
    throw err;
  }

  const queryBase = { tenantId };
  if (excludeEntityId) queryBase._id = { $ne: excludeEntityId };

  if (requestedAcronym) {
    const existing = await Entity.findOne({ ...queryBase, acronym: base }).select('_id').lean();
    if (existing) {
      const err = new Error('Entity acronym must be unique within the tenant.');
      err.status = 409;
      throw err;
    }
    return base;
  }

  const existingAcronyms = new Set((await Entity.find(queryBase).select('acronym').lean()).map((item) => String(item.acronym || '').toUpperCase()));
  if (!existingAcronyms.has(base)) return base;
  for (let i = 1; i <= 99; i += 1) {
    const candidate = `${base.slice(0, 3)}${i % 10}`;
    if (!existingAcronyms.has(candidate)) return candidate;
  }
  const err = new Error('Unable to auto-generate a unique four-letter acronym. Please enter one manually.');
  err.status = 409;
  throw err;
}

function normalizeBoolean(value, defaultValue = false) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value === 1;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true', '1', 'yes', 'on'].includes(normalized)) return true;
    if (['false', '0', 'no', 'off', ''].includes(normalized)) return false;
  }
  return defaultValue;
}

function normalizeJiraConfig(input = {}, { isSubclient = false } = {}) {
  const projectKey = String(input.projectKey || '').trim().toUpperCase();
  const projectId = String(input.projectId || '').trim();
  const issueTypeId = String(input.issueTypeId || '').trim();
  const issueTypeName = String(input.issueTypeName || '').trim();
  const isEnabled = normalizeBoolean(input.isEnabled, false);
  const inheritFromParent = isSubclient ? normalizeBoolean(input.inheritFromParent, true) : false;
  const autoPushOnCreate = normalizeBoolean(input.autoPushOnCreate, false);
  if (!isEnabled) {
    return {
      isEnabled: false,
      projectKey: '',
      projectId: '',
      issueTypeId: '',
      issueTypeName: '',
      autoPushOnCreate: false,
      inheritFromParent,
      lastMetadataSyncAt: null
    };
  }
  return {
    isEnabled: true,
    projectKey,
    projectId,
    issueTypeId,
    issueTypeName,
    autoPushOnCreate,
    inheritFromParent,
    lastMetadataSyncAt: input.lastMetadataSyncAt || null
  };
}

function hasUsableJiraConfig(config) {
  return !!(config && config.isEnabled && config.projectKey && (config.issueTypeId || config.issueTypeName));
}

async function createEntityForTenant({ tenantId, name, acronym = '', type, parentId = null, metadata = {}, jiraConfig = {}, commitmentDefaults = {} }) {
  const cleanName = sanitizeName(name);
  if (!cleanName) {
    const err = new Error('Entity name is required.');
    err.status = 400;
    throw err;
  }

  if (!['client', 'subclient'].includes(type)) {
    const err = new Error('Entity type must be either client or subclient.');
    err.status = 400;
    throw err;
  }

  let parent = null;
  if (parentId) {
    if (!mongoose.Types.ObjectId.isValid(parentId)) {
      const err = new Error('Parent entity id is invalid.');
      err.status = 400;
      throw err;
    }
    parent = await Entity.findOne({ _id: parentId, tenantId });
    if (!parent) {
      const err = new Error('Parent entity not found.');
      err.status = 404;
      throw err;
    }
  }

  if (type === 'client' && parent) {
    const err = new Error('A client cannot have a parent entity.');
    err.status = 400;
    throw err;
  }

  if (type === 'subclient' && !parent) {
    const err = new Error('A subclient must have a parent entity.');
    err.status = 400;
    throw err;
  }

  const acronymValue = await resolveUniqueAcronym({ tenantId, name: cleanName, requestedAcronym: acronym });

  const path = parent ? `${parent.path} / ${cleanName}` : cleanName;
  const existing = await Entity.findOne({ tenantId, path });
  if (existing) {
    const err = new Error('An entity with the same hierarchy path already exists.');
    err.status = 409;
    throw err;
  }

  const entity = await Entity.create({
    tenantId,
    name: cleanName,
    acronym: acronymValue,
    type,
    parentId: parent ? parent._id : null,
    path,
    metadata: {
      region: metadata.region || '',
      product: metadata.product || '',
      productIds: Array.isArray(metadata.productIds) ? metadata.productIds : [],
      slaTier: metadata.slaTier || ''
    },
    commitmentDefaults: {
      inheritFromParent: commitmentDefaults.inheritFromParent !== false,
      slaPolicyId: commitmentDefaults.slaPolicyId || null,
      olaPolicyId: commitmentDefaults.olaPolicyId || null
    },
    jiraConfig: normalizeJiraConfig(jiraConfig, { isSubclient: type === 'subclient' })
  });

  return entity;
}

async function listEntitiesForTenant(tenantId) {
  return Entity.find({ tenantId }).populate('parentId').sort({ path: 1 });
}

async function getEntityForTenant({ tenantId, entityId }) {
  return Entity.findOne({ _id: entityId, tenantId }).populate('parentId');
}

async function updateEntityJiraConfig({ tenantId, entityId, jiraConfig }) {
  const entity = await Entity.findOne({ _id: entityId, tenantId });
  if (!entity) {
    const err = new Error('Entity not found.');
    err.status = 404;
    throw err;
  }
  entity.jiraConfig = normalizeJiraConfig(jiraConfig, { isSubclient: entity.type === 'subclient' });
  await entity.save();
  return entity;
}

async function resolveEffectiveEntityJiraConfig({ tenantId, entityId, tenantDefaultConfig = null }) {
  const visited = new Set();
  let current = await Entity.findOne({ _id: entityId, tenantId });
  while (current) {
    const key = String(current._id);
    if (visited.has(key)) break;
    visited.add(key);
    if (hasUsableJiraConfig(current.jiraConfig)) {
      return {
        source: current._id.equals(entityId) ? 'SELF' : 'PARENT',
        entity: current,
        config: current.jiraConfig.toObject ? current.jiraConfig.toObject() : current.jiraConfig
      };
    }
    if (!current.parentId || !current.jiraConfig?.inheritFromParent) break;
    current = await Entity.findOne({ _id: current.parentId, tenantId });
  }
  if (hasUsableJiraConfig(tenantDefaultConfig)) {
    return { source: 'TENANT_DEFAULT', entity: null, config: tenantDefaultConfig };
  }
  return { source: 'NONE', entity: null, config: null };
}



async function rebuildEntityPath(entity) {
  const parent = entity.parentId ? await Entity.findById(entity.parentId) : null;
  const newPath = parent ? `${parent.path} / ${entity.name}` : entity.name;
  entity.path = newPath;
  await entity.save();
  const children = await Entity.find({ parentId: entity._id, tenantId: entity.tenantId });
  for (const child of children) {
    await rebuildEntityPath(child);
  }
  return entity;
}

async function updateEntityForTenant({ tenantId, entityId, updates = {} }) {
  const entity = await Entity.findOne({ _id: entityId, tenantId });
  if (!entity) {
    const err = new Error('Entity not found.');
    err.status = 404;
    throw err;
  }

  const cleanName = sanitizeName(updates.name || entity.name);
  const nextType = updates.type || entity.type;
  let nextParentId = Object.prototype.hasOwnProperty.call(updates, 'parentId') ? (updates.parentId || null) : entity.parentId;

  if (!['client', 'subclient'].includes(nextType)) {
    const err = new Error('Entity type must be either client or subclient.');
    err.status = 400;
    throw err;
  }

  if (String(nextType) === 'client') nextParentId = null;
  if (String(nextType) === 'subclient' && !nextParentId) {
    const err = new Error('A subclient must have a parent entity.');
    err.status = 400;
    throw err;
  }

  if (nextParentId && String(nextParentId) === String(entity._id)) {
    const err = new Error('An entity cannot be its own parent.');
    err.status = 400;
    throw err;
  }

  let parent = null;
  if (nextParentId) {
    parent = await Entity.findOne({ _id: nextParentId, tenantId });
    if (!parent) {
      const err = new Error('Parent entity not found.');
      err.status = 404;
      throw err;
    }
    if (String(parent.type) !== 'client') {
      const err = new Error('Only client entities can be used as parent.');
      err.status = 400;
      throw err;
    }
  }

  const allTenantEntities = await Entity.find({ tenantId }).select('_id path');
  const descendantIds = new Set(allTenantEntities.filter((item) => String(item.path || '').startsWith(`${entity.path} / `)).map((item) => String(item._id)));
  if (parent && descendantIds.has(String(parent._id))) {
    const err = new Error('Cannot move entity under one of its descendants.');
    err.status = 400;
    throw err;
  }

  const nextPath = parent ? `${parent.path} / ${cleanName}` : cleanName;
  const existing = await Entity.findOne({ tenantId, path: nextPath, _id: { $ne: entity._id } });
  if (existing) {
    const err = new Error('An entity with the same hierarchy path already exists.');
    err.status = 409;
    throw err;
  }

  const nextAcronym = await resolveUniqueAcronym({ tenantId, name: cleanName, requestedAcronym: updates.acronym || entity.acronym, excludeEntityId: entity._id });

  entity.name = cleanName;
  entity.acronym = nextAcronym;
  entity.type = nextType;
  entity.parentId = parent ? parent._id : null;
  entity.metadata = {
    region: updates.metadata?.region ?? updates.region ?? entity.metadata?.region ?? '',
    product: updates.metadata?.product ?? updates.product ?? entity.metadata?.product ?? '',
    slaTier: updates.metadata?.slaTier ?? updates.slaTier ?? entity.metadata?.slaTier ?? ''
  };

  if (updates.jiraConfig) entity.jiraConfig = normalizeJiraConfig(updates.jiraConfig, { isSubclient: nextType === 'subclient' });
  await rebuildEntityPath(entity);
  return Entity.findById(entity._id).populate('parentId');
}

async function setEntityActiveState({ tenantId, entityId, isActive }) {
  const entity = await Entity.findOne({ _id: entityId, tenantId });
  if (!entity) {
    const err = new Error('Entity not found.');
    err.status = 404;
    throw err;
  }
  entity.isActive = !!isActive;
  await entity.save();
  return entity;
}

async function deleteEntityForTenant({ tenantId, entityId }) {
  const entity = await Entity.findOne({ _id: entityId, tenantId });
  if (!entity) {
    const err = new Error('Entity not found.');
    err.status = 404;
    throw err;
  }
  const childCount = await Entity.countDocuments({ tenantId, parentId: entity._id });
  if (childCount > 0) {
    const err = new Error('Cannot delete entity with subclients. Deactivate it or move/delete children first.');
    err.status = 400;
    throw err;
  }
  await Entity.deleteOne({ _id: entity._id, tenantId });
  return entity;
}

module.exports = {
  createEntityForTenant,
  listEntitiesForTenant,
  getEntityForTenant,
  updateEntityForTenant,
  setEntityActiveState,
  deleteEntityForTenant,
  updateEntityJiraConfig,
  resolveEffectiveEntityJiraConfig,
  normalizeJiraConfig,
  hasUsableJiraConfig,
  normalizeBoolean,
  sanitizeAcronym,
  resolveUniqueAcronym
};
