#!/usr/bin/env node
/**
 * Service Manager v24.2.1 — controlled SunTecGroup service-model migration.
 *
 * Purpose
 * -------
 * Moves the EXISTING suntecgroup Incident configuration onto the frozen v24
 * Incident model without deleting historical configuration or touching users,
 * clients, requests, comments, audit history, products/modules, or SLA rules.
 *
 * What it changes
 * ---------------
 * 1. Upserts v24 common Incident workflow (WF_SAAS_INCIDENT).
 * 2. Upserts v24 common L1/L2/L3 Incident support path.
 * 3. Binds Issue Type "Incident" to that workflow + support path.
 * 4. Leaves SLA attached at Issue Type level and makes subtypes inherit it.
 * 5. Binds four subtype-specific v24 forms:
 *      Application, Security, Infrastructure, Operational.
 * 6. Makes those four subtypes inherit workflow/path/SLA from Incident.
 * 7. Preserves all old workflows/support paths in Mongo for rollback/history.
 *
 * Safety
 * ------
 * - DRY RUN is the default.
 * - --apply creates a JSON backup before writing.
 * - No deletes.
 * - Existing requests are NOT rewritten. New requests use v24 configuration.
 *
 * Usage
 * -----
 *   node scripts/migrate-suntecgroup-to-v24.2.1.mjs
 *   node scripts/migrate-suntecgroup-to-v24.2.1.mjs --workspace=suntecgroup --dry-run
 *   node scripts/migrate-suntecgroup-to-v24.2.1.mjs --workspace=suntecgroup --apply
 *
 * Optional:
 *   --backup-dir=./backups/v24-suntecgroup
 *   --verbose
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import mongoose from 'mongoose';

import { connectDatabase, disconnectDatabase } from '../services/organization-service/src/db.js';
import { Organization } from '../services/organization-service/src/models/Organization.js';
import { IssueType } from '../services/organization-service/src/models/IssueType.js';
import { Workflow } from '../services/organization-service/src/models/Workflow.js';
import { SupportPath } from '../services/organization-service/src/models/SupportPath.js';
import { SlaPolicy } from '../services/organization-service/src/models/SlaPolicy.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const CONFIG_DIR = path.join(ROOT, 'config', 'v24-saas');

const V24_MODEL_KEY = 'SUNTEC_SAAS_V24';
const V24_VERSION = '24.2.1';
const INCIDENT_WORKFLOW_KEY = 'WF_SAAS_INCIDENT';
const INCIDENT_PATH_KEY = 'PATH_INCIDENT_COMMON_V24';
const MAINTENANCE_WORKFLOW_KEY = 'WF_SAAS_MAINTENANCE';

const FORM_BY_SUBTYPE = new Map([
  ['APPLICATION', 'SAAS_INCIDENT_APPLICATION'],
  ['SECURITY', 'SAAS_INCIDENT_SECURITY'],
  ['INFRASTRUCTURE', 'SAAS_INCIDENT_INFRASTRUCTURE'],
  ['OPERATIONAL', 'SAAS_INCIDENT_OPERATIONAL']
]);


const MAINTENANCE_FORM_BY_SUBTYPE = new Map([
  ['SCHEDULED_MAINTENANCE', 'SAAS_MR_SCHEDULED'],
  ['PROACTIVE_MAINTENANCE', 'SAAS_MR_PROACTIVE'],
  ['EMERGENCY_MAINTENANCE', 'SAAS_MR_EMERGENCY'],
  ['VULNERABILITY_RUN', 'SAAS_MR_VULNERABILITY'],
  ['PENETRATION_TEST_RUN', 'SAAS_MR_PEN_TEST'],
  ['ACTUAL_DR', 'SAAS_MR_ACTUAL_DR']
]);

const MAINTENANCE_SUBTYPE_NAMES = new Map([
  ['SCHEDULED_MAINTENANCE', ['Scheduled Maintenance', 'Scheduled Release']],
  ['PROACTIVE_MAINTENANCE', ['Proactive Maintenance', 'Proactive Release']],
  ['EMERGENCY_MAINTENANCE', ['Emergency Maintenance', 'Emergency Release']],
  ['VULNERABILITY_RUN', ['Vulnerability Run', 'Vulnerability Scan']],
  ['PENETRATION_TEST_RUN', ['Penetration Test Run', 'Penetration Test']],
  ['ACTUAL_DR', ['Actual DR', 'Disaster Recovery']]
]);

const SUBTYPE_NAMES = new Map([
  ['APPLICATION', ['Application', 'Application Incident']],
  ['SECURITY', ['Security', 'Security Incident', 'Cyber Security Incident']],
  ['INFRASTRUCTURE', ['Infrastructure', 'Infrastructure Incident']],
  ['OPERATIONAL', ['Operational', 'Operational Incident', 'Operations Incident', 'Operation Incident']]
]);

function valueArg(name, fallback = '') {
  const prefix = `${name}=`;
  const value = process.argv.slice(2).find((item) => item.startsWith(prefix));
  return value ? value.slice(prefix.length) : fallback;
}

const ARGS = new Set(process.argv.slice(2));
const APPLY = ARGS.has('--apply');
const WORKSPACE = String(valueArg('--workspace', 'suntecgroup')).trim().toLowerCase();
const VERBOSE = ARGS.has('--verbose');
const BACKUP_ROOT = path.resolve(process.cwd(), valueArg('--backup-dir', './backups/v24-suntecgroup'));

function log(...args) { console.log(...args); }
function debug(...args) { if (VERBOSE) console.log(...args); }
function loadJson(name) { return JSON.parse(fs.readFileSync(path.join(CONFIG_DIR, name), 'utf8')); }
function asId(value) { return value ? String(value) : ''; }
function normalize(value) { return String(value || '').trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, ''); }
function unique(values) { return [...new Set(values.filter(Boolean))]; }
function timestamp() { return new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z'); }

function plain(value) {
  if (value == null) return value;
  if (typeof value.toObject === 'function') return value.toObject({ depopulate: true });
  return JSON.parse(JSON.stringify(value));
}

function same(a, b) {
  return JSON.stringify(plain(a)) === JSON.stringify(plain(b));
}

const manifest = loadJson('service-model.json');
const workflowsDoc = loadJson('workflows.json');
const supportPathsDoc = loadJson('support-paths.json');
const formsDoc = loadJson('form-definitions.json');
const mappingDoc = loadJson('subtype-workflow-map.json');
const rolesDoc = loadJson('role-capabilities.json');
const approvalsDoc = loadJson('approval-policies.json');
const productVersionDoc = loadJson('product-version-model.json');
const fieldRegistryDoc = loadJson('field-registry.json');
const fieldRegistry = new Map((fieldRegistryDoc.fields || []).map((item) => [item.key, item]));

if (manifest.key !== V24_MODEL_KEY || manifest.version !== V24_VERSION) {
  throw new Error(`Expected ${V24_MODEL_KEY} ${V24_VERSION} config.`);
}

const incidentWorkflowConfig = (workflowsDoc.workflows || []).find((item) => item.key === INCIDENT_WORKFLOW_KEY);
const incidentPathConfig = (supportPathsDoc.supportPaths || []).find((item) => item.key === INCIDENT_PATH_KEY);
const incidentForms = new Map((formsDoc.forms || []).filter((item) => item.family === 'INCIDENT').map((item) => [item.key, item]));
const maintenanceForms = new Map((formsDoc.forms || []).filter((item) => item.family === 'MAINTENANCE').map((item) => [item.key, item]));

if (!incidentWorkflowConfig) throw new Error(`Missing ${INCIDENT_WORKFLOW_KEY} in v24 workflows.json.`);
if (!incidentPathConfig) throw new Error(`Missing ${INCIDENT_PATH_KEY} in v24 support-paths.json.`);
for (const formKey of FORM_BY_SUBTYPE.values()) {
  if (!incidentForms.has(formKey)) throw new Error(`Missing ${formKey} in v24 form-definitions.json.`);
}
for (const formKey of MAINTENANCE_FORM_BY_SUBTYPE.values()) {
  if (!maintenanceForms.has(formKey)) throw new Error(`Missing ${formKey} in v24 form-definitions.json.`);
}
if (!(workflowsDoc.workflows || []).some((item) => item.key === MAINTENANCE_WORKFLOW_KEY)) throw new Error(`Missing ${MAINTENANCE_WORKFLOW_KEY} in v24 workflows.json.`);

function mapStatus(item, index) {
  const localId = String(item.key || item.localId || '').trim().toUpperCase();
  if (!localId) throw new Error(`Workflow status at index ${index} has no key.`);
  return {
    localId,
    name: String(item.name || localId).trim(),
    description: String(item.description || `${item.name || localId} stage.`).trim().slice(0, 280),
    customerLabel: String(item.customerLabel || item.name || localId).trim(),
    statusType: ['start', 'normal', 'hold', 'waiting', 'resolved', 'final', 'cancelled'].includes(item.statusType)
      ? item.statusType
      : (item.category === 'final' ? 'final' : item.category === 'resolved' ? 'resolved' : 'normal'),
    isCustomerVisible: item.isCustomerVisible !== false,
    isActive: item.isActive !== false,
    displayOrder: Number(item.displayOrder || ((index + 1) * 10)),
    taskTemplates: []
  };
}

function mapTransition(item) {
  return {
    fromStatusId: String(item.from || item.fromStatusId || '').trim().toUpperCase(),
    toStatusId: String(item.to || item.toStatusId || '').trim().toUpperCase(),
    localId: String(item.key || item.localId || '').trim().toUpperCase(),
    name: String(item.label || item.name || '').trim(),
    transitionType: String(item.kind || item.transitionType || 'status').trim(),
    customerEnabled: Boolean(item.customerEnabled),
    roles: Array.isArray(item.roles) ? item.roles : [],
    allowedSupportLevels: Array.isArray(item.allowedSupportLevels) ? item.allowedSupportLevels : [],
    targetSupportLevel: String(item.targetSupportLevel || item.supportEffect?.targetLevel || '').trim().toUpperCase(),
    jiraTransitionId: String(item.jiraTransitionId || '').trim(),
    condition: item.condition || {},
    supportEffect: item.supportEffect || {}
  };
}

function mapGlobalAction(item) {
  return {
    key: String(item.key || '').trim().toUpperCase(),
    label: String(item.label || '').trim(),
    kind: String(item.kind || 'escalation').trim(),
    statusEffect: String(item.statusEffect || 'KEEP').trim().toUpperCase(),
    customerEnabled: Boolean(item.customerEnabled),
    roles: Array.isArray(item.roles) ? item.roles : [],
    jiraTransitionId: String(item.jiraTransitionId || '').trim(),
    condition: item.condition || {}
  };
}

function buildWorkflowDocument(organizationId) {
  return {
    organizationId,
    key: INCIDENT_WORKFLOW_KEY,
    name: String(incidentWorkflowConfig.name || 'Incident — Common v24 Workflow').slice(0, 90),
    description: String(incidentWorkflowConfig.description || 'Common v24 JSM-aligned Incident workflow.').slice(0, 420),
    statuses: (incidentWorkflowConfig.statuses || []).map(mapStatus),
    transitions: (incidentWorkflowConfig.transitions || []).map(mapTransition),
    globalActions: (incidentWorkflowConfig.globalActions || []).map(mapGlobalAction),
    status: 'active'
  };
}

function buildSupportPathDocument(organizationId, workflow) {
  const levels = (incidentPathConfig.levels || []).map((item, index) => ({
    localId: String(item.localId || '').trim().toUpperCase(),
    label: String(item.label || '').trim(),
    ownerSide: item.ownerSide,
    slaApplicable: Boolean(item.slaApplicable),
    displayOrder: Number(item.displayOrder || ((index + 1) * 10)),
    workflowId: workflow._id,
    workflowName: workflow.name
  }));

  const movementRules = (incidentPathConfig.movementRules || []).map((item, index) => ({
    localId: String(item.localId || '').trim().toLowerCase(),
    actionLabel: String(item.actionLabel || '').trim(),
    fromLevelId: String(item.fromLevelId || '').trim().toUpperCase(),
    toLevelId: String(item.toLevelId || '').trim().toUpperCase(),
    movementType: item.movementType === 'parallel' ? 'parallel' : 'sequential',
    targetStatusBehavior: ['keep', 'start', 'explicit'].includes(item.targetStatusBehavior) ? item.targetStatusBehavior : 'explicit',
    targetStatusId: String(item.targetStatusId || '').trim().toUpperCase(),
    allowedFromStatusIds: (item.allowedFromStatusIds || []).map((value) => String(value).trim().toUpperCase()),
    customerEnabled: Boolean(item.customerEnabled),
    roles: Array.isArray(item.roles) ? item.roles : [],
    condition: item.condition || {},
    toLevelIds: unique([...(item.toLevelIds || []), item.toLevelId]).map((value) => String(value).trim().toUpperCase()),
    primaryLevelId: String(item.primaryLevelId || item.toLevelId || '').trim().toUpperCase(),
    commentRequired: item.commentRequired !== false,
    reasonRequired: item.reasonRequired !== false,
    displayOrder: Number(item.displayOrder || ((index + 1) * 10))
  }));

  return {
    organizationId,
    key: INCIDENT_PATH_KEY,
    name: String(incidentPathConfig.name).slice(0, 100),
    description: String(incidentPathConfig.description).slice(0, 420),
    levels,
    movementRules,
    status: 'active'
  };
}

async function findOrg() {
  const org = await Organization.findOne({
    $or: [
      { workspaceSlug: WORKSPACE },
      { shortCode: WORKSPACE.toUpperCase() },
      { name: new RegExp(`^${WORKSPACE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') }
    ]
  });
  if (!org) throw new Error(`Organization/workspace '${WORKSPACE}' not found.`);
  return org;
}

async function findTaxonomy(orgId) {
  const family = await IssueType.findOne({
    organizationId: orgId,
    level: 1,
    status: 'active',
    $or: [{ key: 'REQUEST' }, { name: /^Request$/i }]
  });
  if (!family) throw new Error('Request family not found. Migration will not create a replacement taxonomy automatically.');

  const incident = await IssueType.findOne({
    organizationId: orgId,
    level: 2,
    parentTypeId: family._id,
    status: 'active',
    $or: [{ key: 'INCIDENT' }, { name: /^Incident$/i }]
  });
  if (!incident) throw new Error('Incident issue type not found below Request family.');

  const children = await IssueType.find({
    organizationId: orgId,
    level: 3,
    parentTypeId: incident._id,
    status: 'active'
  });

  const resolved = new Map();
  for (const canonical of FORM_BY_SUBTYPE.keys()) {
    const names = SUBTYPE_NAMES.get(canonical) || [];
    const match = children.find((child) => normalize(child.key) === canonical || names.some((name) => String(child.name).toLowerCase() === name.toLowerCase()));
    if (!match) throw new Error(`Required Incident subtype '${canonical}' not found. Found: ${children.map((x) => `${x.key}/${x.name}`).join(', ')}`);
    resolved.set(canonical, match);
  }

  return { family, incident, subtypes: resolved, allIncidentChildren: children };
}


async function findMaintenanceTaxonomy(orgId, familyId) {
  const issueType = await IssueType.findOne({
    organizationId: orgId,
    level: 2,
    parentTypeId: familyId,
    status: 'active',
    $or: [{ key: 'MAINTENANCE_REQUEST' }, { name: /^Maintenance Request$/i }]
  });
  if (!issueType) throw new Error('Maintenance Request issue type not found below Request family.');

  const children = await IssueType.find({
    organizationId: orgId,
    level: 3,
    parentTypeId: issueType._id,
    status: 'active'
  });

  const resolved = new Map();
  for (const canonical of MAINTENANCE_FORM_BY_SUBTYPE.keys()) {
    const names = MAINTENANCE_SUBTYPE_NAMES.get(canonical) || [];
    const match = children.find((child) =>
      normalize(child.key) === canonical ||
      names.some((name) => String(child.name || '').toLowerCase() === name.toLowerCase())
    );
    if (!match) {
      throw new Error(`Required Maintenance subtype '${canonical}' not found. Found: ${children.map((x) => `${x.key}/${x.name}`).join(', ')}`);
    }
    resolved.set(canonical, match);
  }
  return { issueType, subtypes: resolved, allChildren: children };
}

async function resolveIncidentSlaPolicy(taxonomy) {
  if (taxonomy.incident.slaPolicyId) {
    const policy = await SlaPolicy.findOne({ _id: taxonomy.incident.slaPolicyId, organizationId: taxonomy.incident.organizationId });
    return { policy, source: 'Incident issue type' };
  }

  const childPolicyIds = unique([...taxonomy.subtypes.values()].map((item) => asId(item.slaPolicyId)));
  if (childPolicyIds.length === 1) {
    const policy = await SlaPolicy.findOne({ _id: childPolicyIds[0], organizationId: taxonomy.incident.organizationId });
    return { policy, source: 'common Incident subtype SLA' };
  }

  if (childPolicyIds.length > 1) {
    throw new Error(`Incident subtypes reference multiple SLA policies (${childPolicyIds.join(', ')}). v24 expects SLA at Issue Type=Incident. Resolve this ambiguity before applying.`);
  }

  // A null direct policy is valid: runtime can still obtain the client's family/support-plan SLA mapping.
  return { policy: null, source: 'client/support-plan family SLA mapping' };
}

async function writeBackup(org, taxonomy) {
  const dir = path.join(BACKUP_ROOT, `${WORKSPACE}-${timestamp()}`);
  fs.mkdirSync(dir, { recursive: true });

  const [workflows, paths, slas, issueTypes] = await Promise.all([
    Workflow.find({ organizationId: org._id }).lean(),
    SupportPath.find({ organizationId: org._id }).lean(),
    SlaPolicy.find({ organizationId: org._id }).lean(),
    IssueType.find({ organizationId: org._id }).sort({ level: 1, displayOrder: 1, name: 1 }).lean()
  ]);

  const payload = {
    backedUpAt: new Date().toISOString(),
    migrationTarget: V24_VERSION,
    organization: plain(org),
    taxonomy: { familyId: asId(taxonomy.family._id), incidentId: asId(taxonomy.incident._id) },
    issueTypes,
    workflows,
    supportPaths: paths,
    slaPolicies: slas
  };

  fs.writeFileSync(path.join(dir, 'suntecgroup-config-before-v24.json'), JSON.stringify(payload, null, 2));
  return dir;
}

async function upsertIncidentWorkflow(orgId) {
  const desired = buildWorkflowDocument(orgId);
  let workflow = await Workflow.findOne({ organizationId: orgId, key: INCIDENT_WORKFLOW_KEY });

  if (!workflow) {
    log(`  + Workflow ${INCIDENT_WORKFLOW_KEY}`);
    if (!APPLY) return { _id: 'DRY_RUN_WORKFLOW_ID', ...desired };
    return Workflow.create(desired);
  }

  const changed = !same(
    { name: workflow.name, description: workflow.description, statuses: workflow.statuses, transitions: workflow.transitions, globalActions: workflow.globalActions, status: workflow.status },
    { name: desired.name, description: desired.description, statuses: desired.statuses, transitions: desired.transitions, globalActions: desired.globalActions, status: desired.status }
  );
  log(`  ${changed ? '~' : '='} Workflow ${INCIDENT_WORKFLOW_KEY}`);
  if (changed && APPLY) {
    Object.assign(workflow, desired);
    await workflow.save();
  }
  return workflow;
}

function buildWorkflowFromConfig(organizationId, cfg) {
  return {
    organizationId,
    key: cfg.key,
    name: String(cfg.name || cfg.key).slice(0, 90),
    description: String(cfg.description || `${cfg.name || cfg.key} workflow.`).slice(0, 420),
    statuses: (cfg.statuses || []).map(mapStatus),
    transitions: (cfg.transitions || []).map(mapTransition),
    globalActions: (cfg.globalActions || []).map(mapGlobalAction),
    status: 'active'
  };
}

async function upsertNamedWorkflow(orgId, key) {
  const cfg = (workflowsDoc.workflows || []).find((item) => item.key === key);
  if (!cfg) throw new Error(`Missing ${key} in v24 workflows.json.`);
  const desired = buildWorkflowFromConfig(orgId, cfg);
  let workflow = await Workflow.findOne({ organizationId: orgId, key });
  if (!workflow) {
    log(`  + Workflow ${key}`);
    if (!APPLY) return { _id: `DRY_RUN_${key}`, ...desired };
    return Workflow.create(desired);
  }
  const changed = !same(
    { name: workflow.name, description: workflow.description, statuses: workflow.statuses, transitions: workflow.transitions, globalActions: workflow.globalActions, status: workflow.status },
    { name: desired.name, description: desired.description, statuses: desired.statuses, transitions: desired.transitions, globalActions: desired.globalActions, status: desired.status }
  );
  log(`  ${changed ? '~' : '='} Workflow ${key}`);
  if (changed && APPLY) { Object.assign(workflow, desired); await workflow.save(); }
  return workflow;
}

async function bindIssueTypeWorkflow(orgId, familyId, names, workflow) {
  const issueType = await IssueType.findOne({
    organizationId: orgId, level: 2, parentTypeId: familyId, status: 'active',
    $or: names.map((name) => ({ name: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') }))
  });
  if (!issueType) throw new Error(`Issue Type ${names[0]} not found below Request family.`);
  log(`  ${asId(issueType.workflowId) === asId(workflow._id) ? '=' : '~'} ${issueType.name} -> ${workflow.key}`);
  if (APPLY) { issueType.workflowId = workflow._id; issueType.status = 'active'; await issueType.save(); }
  return issueType;
}

function customFieldFromForm(formField, index) {
  const registry = fieldRegistry.get(formField.key) || {};
  const typeMap = { text: 'short_text', textarea: 'long_text', select: 'dropdown', multiselect: 'multi_select', checkbox: 'checkbox', url: 'url', number: 'number', date: 'date' };
  const choices = formField.options || registry.options || [];
  const fieldType = registry.type === 'select' && registry.source && !choices.length
    ? 'short_text'
    : (typeMap[registry.type] || 'short_text');
  return {
    fieldKey: formField.key,
    label: formField.label || registry.label || formField.key,
    fieldType,
    required: formField.required ?? registry.required ?? false,
    helpText: String(formField.helpText || registry.helpText || '').slice(0, 260),
    optionsText: choices.map((item) => String(item.label || item.value || item)).join('\n').slice(0, 1200),
    displayOrder: Number(formField.displayOrder || ((index + 1) * 10)),
    status: 'active'
  };
}

function mergeConfiguredCustomFields(existing = [], formKey) {
  const form = incidentForms.get(formKey);
  const configurableKeys = new Set(['INCIDENT_FURTHER_CLASSIFICATION', 'COMPONENTS', 'CLIENT_DATA_INVOLVED', 'S3_BUCKET_URL']);
  const desired = (form?.fields || []).filter((field) => configurableKeys.has(field.key)).map(customFieldFromForm);
  const byKey = new Map((existing || []).map((field) => [String(field.fieldKey || '').toUpperCase(), plain(field)]));
  for (const field of desired) byKey.set(field.fieldKey, field);
  return [...byKey.values()];
}


function mergeMaintenanceCustomFields(existing = [], formKey) {
  const form = maintenanceForms.get(formKey);
  const coreKeys = new Set(['SUMMARY', 'DESCRIPTION', 'PRIORITY', 'RAISED_ENVIRONMENT']);
  const desired = (form?.fields || [])
    .filter((field) => !coreKeys.has(String(field.key || '').toUpperCase()))
    .map(customFieldFromForm);
  const byKey = new Map((existing || []).map((field) => [String(field.fieldKey || '').toUpperCase(), plain(field)]));
  for (const field of desired) byKey.set(String(field.fieldKey || '').toUpperCase(), field);
  return [...byKey.values()];
}

async function upsertSupportPath(orgId, workflow) {
  const desired = buildSupportPathDocument(orgId, workflow);
  let supportPath = await SupportPath.findOne({ organizationId: orgId, key: INCIDENT_PATH_KEY });

  if (!supportPath) {
    log(`  + Support Path ${INCIDENT_PATH_KEY}`);
    if (!APPLY) return { _id: 'DRY_RUN_PATH_ID', ...desired };
    return SupportPath.create(desired);
  }

  const changed = !same(
    { name: supportPath.name, description: supportPath.description, levels: supportPath.levels, movementRules: supportPath.movementRules, status: supportPath.status },
    { name: desired.name, description: desired.description, levels: desired.levels, movementRules: desired.movementRules, status: desired.status }
  );
  log(`  ${changed ? '~' : '='} Support Path ${INCIDENT_PATH_KEY}`);
  if (changed && APPLY) {
    Object.assign(supportPath, desired);
    await supportPath.save();
  }
  return supportPath;
}

async function migrateTaxonomy(taxonomy, workflow, supportPath, slaInfo) {
  const parentBefore = {
    workflowId: asId(taxonomy.incident.workflowId),
    supportPathId: asId(taxonomy.incident.supportPathId),
    slaApplicable: taxonomy.incident.slaApplicable,
    slaPolicyId: asId(taxonomy.incident.slaPolicyId)
  };

  const targetSlaPolicyId = slaInfo.policy?._id || taxonomy.incident.slaPolicyId || null;
  const parentAfter = {
    workflowId: asId(workflow._id),
    supportPathId: asId(supportPath._id),
    slaApplicable: true,
    slaPolicyId: asId(targetSlaPolicyId)
  };

  log(`\nINCIDENT ISSUE TYPE`);
  log(`  ${same(parentBefore, parentAfter) ? '=' : '~'} Incident -> workflow=${INCIDENT_WORKFLOW_KEY}, path=${INCIDENT_PATH_KEY}, SLA=${slaInfo.policy?.key || slaInfo.source}`);

  if (APPLY) {
    taxonomy.incident.workflowId = workflow._id;
    taxonomy.incident.supportPathId = supportPath._id;
    taxonomy.incident.slaApplicable = true;
    taxonomy.incident.slaPolicyId = targetSlaPolicyId;
    taxonomy.incident.formDefinitionKey = '';
    taxonomy.incident.status = 'active';
    await taxonomy.incident.save();
  }

  log(`\nINCIDENT SUBTYPES`);
  for (const [canonical, subtype] of taxonomy.subtypes.entries()) {
    const formKey = FORM_BY_SUBTYPE.get(canonical);
    const before = {
      workflowId: asId(subtype.workflowId),
      supportPathId: asId(subtype.supportPathId),
      slaApplicable: subtype.slaApplicable,
      slaPolicyId: asId(subtype.slaPolicyId),
      formDefinitionKey: subtype.formDefinitionKey || ''
    };
    const after = {
      workflowId: '',
      supportPathId: '',
      slaApplicable: null,
      slaPolicyId: '',
      formDefinitionKey: formKey
    };

    log(`  ${same(before, after) ? '=' : '~'} ${subtype.name} -> Form=${formKey}; Workflow/Path/SLA=inherit from Incident`);
    debug('    before:', before);
    debug('    after :', after);

    const mergedCustomFields = mergeConfiguredCustomFields(subtype.customFields || [], formKey);
    const componentField = mergedCustomFields.find((field) => String(field.fieldKey).toUpperCase() === 'COMPONENTS');
    log(`    ${componentField ? '✓' : '!'} Components LOV ${componentField ? `(${componentField.optionsText.replace(/\n/g, ', ')})` : 'missing'}`);
    if (APPLY) {
      subtype.workflowId = null;
      subtype.supportPathId = null;
      subtype.slaApplicable = null;
      subtype.slaPolicyId = null;
      subtype.formDefinitionKey = formKey;
      subtype.approvalPolicyKey = '';
      subtype.customFields = mergedCustomFields;
      subtype.status = 'active';
      await subtype.save();
    }
  }
}


async function migrateMaintenanceTaxonomy(maintenance, workflow) {
  log(`\nMAINTENANCE REQUEST ISSUE TYPE`);
  const changed = asId(maintenance.issueType.workflowId) !== asId(workflow._id) || maintenance.issueType.slaApplicable !== false || Boolean(maintenance.issueType.slaPolicyId);
  log(`  ${changed ? '~' : '='} Maintenance Request -> workflow=${MAINTENANCE_WORKFLOW_KEY}; SLA=not applicable`);
  if (APPLY) {
    maintenance.issueType.workflowId = workflow._id;
    maintenance.issueType.slaApplicable = false;
    maintenance.issueType.slaPolicyId = null;
    maintenance.issueType.formDefinitionKey = '';
    maintenance.issueType.status = 'active';
    await maintenance.issueType.save();
  }

  log(`\nMAINTENANCE SUBTYPES`);
  for (const [canonical, subtype] of maintenance.subtypes.entries()) {
    const formKey = MAINTENANCE_FORM_BY_SUBTYPE.get(canonical);
    const mergedCustomFields = mergeMaintenanceCustomFields(subtype.customFields || [], formKey);
    log(`  ~ ${subtype.name} -> Form=${formKey}; Workflow/SLA inherit from Maintenance Request; ${mergedCustomFields.length} configured form fields`);
    if (APPLY) {
      subtype.workflowId = null;
      // Preserve existing subtype-specific support paths (DevOps/Security/DR Ops) if present.
      subtype.slaApplicable = null;
      subtype.slaPolicyId = null;
      subtype.formDefinitionKey = formKey;
      subtype.approvalPolicyKey = '';
      subtype.fieldsConfig = {
        severity: false,
        priority: true,
        product: false,
        module: false,
        region: false,
        environment: true
      };
      subtype.customFields = mergedCustomFields;
      subtype.status = 'active';
      await subtype.save();
    }
  }
}

async function upsertV24ConfigurationStore(orgId, maintenance) {
  const collectionName = process.env.V24_SERVICE_MODEL_COLLECTION || 'v24_service_models';
  const configCollection = mongoose.connection.collection(collectionName);
  const configDocs = [
    ['manifest', 'manifest', manifest],
    ['field_registry', 'fields', fieldRegistryDoc],
    ['form_definitions', 'forms', formsDoc],
    ['workflows', 'workflows', workflowsDoc],
    ['subtype_workflow_map', 'bindings', mappingDoc],
    ['role_capabilities', 'roles', rolesDoc],
    ['approval_policies', 'approvals', approvalsDoc],
    ['product_version_model', 'product_versions', productVersionDoc],
    ['support_paths', 'support_paths', supportPathsDoc]
  ];

  log(`\nV24 RUNTIME CONFIG STORE (${collectionName})`);
  for (const [kind, key, payload] of configDocs) {
    log(`  ${APPLY ? '✓' : '~'} ${kind} @ ${V24_VERSION}`);
    if (APPLY) {
      await configCollection.updateOne(
        { serviceModelKey: V24_MODEL_KEY, kind, key },
        { $set: { serviceModelKey: V24_MODEL_KEY, kind, key, version: V24_VERSION, payload, updatedAt: new Date() }, $setOnInsert: { createdAt: new Date() } },
        { upsert: true }
      );
    }
  }

  const sourceCollection = IssueType.collection.name;
  const rawTypes = mongoose.connection.collection(sourceCollection);
  for (const [canonical, subtype] of maintenance.subtypes.entries()) {
    const formKey = MAINTENANCE_FORM_BY_SUBTYPE.get(canonical);
    const form = maintenanceForms.get(formKey);
    const sourceId = asId(subtype._id);
    const filter = { serviceModelKey: V24_MODEL_KEY, kind: 'type_binding', sourceCollection, sourceId };
    const binding = {
      ...filter,
      version: V24_VERSION,
      organizationId: asId(orgId),
      typeIds: [sourceId],
      matchedName: subtype.name,
      family: 'MAINTENANCE',
      subtype: form.subtype,
      formKey,
      workflowKey: MAINTENANCE_WORKFLOW_KEY,
      approvalPolicyKey: '',
      allowRaisedOnBehalfOf: true,
      clientPrioritySelectable: false,
      updatedAt: new Date()
    };
    log(`  ${APPLY ? '✓' : '~'} type binding ${subtype.name} -> ${formKey}`);
    if (APPLY) {
      await configCollection.updateOne(filter, { $set: binding, $setOnInsert: { createdAt: new Date() } }, { upsert: true });
      await rawTypes.updateOne(
        { _id: subtype._id },
        { $set: { serviceModelKey: V24_MODEL_KEY, v24FormKey: formKey, v24WorkflowKey: MAINTENANCE_WORKFLOW_KEY, v24ApprovalPolicyKey: '', v24ConfigVersion: V24_VERSION } }
      );
    }
  }
}

async function verifyMaintenance(orgId, maintenanceIds) {
  const [issueType, subtypes, workflow] = await Promise.all([
    IssueType.findById(maintenanceIds.issueTypeId).lean(),
    IssueType.find({ _id: { $in: maintenanceIds.subtypeIds } }).lean(),
    Workflow.findOne({ organizationId: orgId, key: MAINTENANCE_WORKFLOW_KEY }).lean()
  ]);
  const errors = [];
  if (!workflow) errors.push('Maintenance workflow missing');
  if (issueType && workflow && asId(issueType.workflowId) !== asId(workflow._id)) errors.push('Maintenance Request is not bound to common workflow');
  if (issueType?.slaApplicable !== false) errors.push('Maintenance Request must have SLA disabled');
  if (issueType?.slaPolicyId) errors.push('Maintenance Request must not have an Incident SLA policy');
  for (const subtype of subtypes) {
    const canonical = [...MAINTENANCE_SUBTYPE_NAMES.entries()].find(([key, names]) => normalize(subtype.key) === key || names.some((name) => name.toLowerCase() === String(subtype.name || '').toLowerCase()))?.[0];
    if (!canonical) continue;
    if (subtype.workflowId) errors.push(`${subtype.name} should inherit the Maintenance workflow`);
    if (subtype.slaPolicyId) errors.push(`${subtype.name} must not have an SLA policy`);
    if (subtype.formDefinitionKey !== MAINTENANCE_FORM_BY_SUBTYPE.get(canonical)) errors.push(`${subtype.name} form key mismatch`);
  }
  const statusIds = new Set((workflow?.statuses || []).map((item) => item.localId));
  for (const required of ['NEW','ANALYSIS','APPROVED','COMPLETED','CLOSED','REJECTED','INCIDENT_CREATED','PROBLEM_CREATED']) {
    if (!statusIds.has(required)) errors.push(`Maintenance workflow missing status ${required}`);
  }
  if (errors.length) throw new Error(`Maintenance verification failed:\n- ${errors.join('\n- ')}`);
  return { issueType, subtypes, workflow };
}

async function verify(orgId, taxonomyIds) {
  const [incident, subtypes, workflow, supportPath] = await Promise.all([
    IssueType.findById(taxonomyIds.incidentId).lean(),
    IssueType.find({ _id: { $in: taxonomyIds.subtypeIds } }).lean(),
    Workflow.findOne({ organizationId: orgId, key: INCIDENT_WORKFLOW_KEY }).lean(),
    SupportPath.findOne({ organizationId: orgId, key: INCIDENT_PATH_KEY }).lean()
  ]);

  const errors = [];
  if (!workflow) errors.push('v24 Incident workflow missing');
  if (!supportPath) errors.push('v24 Incident support path missing');
  if (incident && workflow && asId(incident.workflowId) !== asId(workflow._id)) errors.push('Incident not bound to v24 workflow');
  if (incident && supportPath && asId(incident.supportPathId) !== asId(supportPath._id)) errors.push('Incident not bound to v24 support path');
  if (incident?.slaApplicable !== true) errors.push('Incident SLA applicability is not enabled');

  for (const subtype of subtypes) {
    const canonical = [...SUBTYPE_NAMES.entries()].find(([key, names]) => normalize(subtype.key) === key || names.some((name) => name.toLowerCase() === String(subtype.name).toLowerCase()))?.[0];
    if (!canonical) continue;
    if (subtype.workflowId) errors.push(`${subtype.name} should inherit workflow but has explicit workflowId`);
    if (subtype.supportPathId) errors.push(`${subtype.name} should inherit path but has explicit supportPathId`);
    if (subtype.slaApplicable !== null && subtype.slaApplicable !== undefined) errors.push(`${subtype.name} should inherit SLA applicability`);
    if (subtype.slaPolicyId) errors.push(`${subtype.name} should inherit SLA policy`);
    if (subtype.formDefinitionKey !== FORM_BY_SUBTYPE.get(canonical)) errors.push(`${subtype.name} form key mismatch`);
  }

  if (workflow) {
    const statusIds = new Set((workflow.statuses || []).map((item) => item.localId));
    for (const required of ['NEW', 'ANALYSIS', 'L2_SUPPORT', 'L2_ANALYSIS', 'L3_SUPPORT', 'L3_ANALYSIS', 'DEVELOPMENT', 'RELEASE', 'RESOLVED', 'CLOSED']) {
      if (!statusIds.has(required)) errors.push(`workflow missing status ${required}`);
    }
  }

  if (supportPath) {
    const levelIds = new Set((supportPath.levels || []).map((item) => item.localId));
    for (const required of ['L1', 'L2', 'L3']) if (!levelIds.has(required)) errors.push(`support path missing level ${required}`);
    const actionIds = new Set((supportPath.movementRules || []).map((item) => item.localId));
    for (const required of ['request_l2', 'assign_l2', 'assign_l3', 'escalate_l3']) if (!actionIds.has(required)) errors.push(`support path missing action ${required}`);
  }

  if (errors.length) throw new Error(`Post-migration verification failed:\n- ${errors.join('\n- ')}`);
  return { incident, subtypes, workflow, supportPath };
}

async function main() {
  log(`\nService Manager v24 migration`);
  log(`Workspace : ${WORKSPACE}`);
  log(`Target    : ${V24_MODEL_KEY} ${V24_VERSION}`);
  log(`Mode      : ${APPLY ? 'APPLY' : 'DRY RUN'}`);
  log(`Scope     : Incident + Problem + Change Request + Maintenance Request configuration; no request/history/user/client deletes or rewrites.\n`);

  await connectDatabase();
  try {
    const org = await findOrg();
    const taxonomy = await findTaxonomy(org._id);
    const maintenance = await findMaintenanceTaxonomy(org._id, taxonomy.family._id);
    const slaInfo = await resolveIncidentSlaPolicy(taxonomy);

    log(`Organization: ${org.name} (${org.workspaceSlug || org.shortCode})`);
    log(`Request family: ${taxonomy.family.name}`);
    log(`Issue type: ${taxonomy.incident.name}`);
    log(`Incident SLA source: ${slaInfo.policy ? `${slaInfo.policy.name} [${slaInfo.policy.key}]` : slaInfo.source}`);

    if (APPLY) {
      const backupDir = await writeBackup(org, taxonomy);
      log(`Backup: ${backupDir}`);
    } else {
      log('Backup: not created in dry-run mode');
    }

    log(`\nV24 CONFIGURATION`);
    const workflow = await upsertIncidentWorkflow(org._id);
    const problemWorkflow = await upsertNamedWorkflow(org._id, 'WF_SAAS_PROBLEM');
    const changeWorkflow = await upsertNamedWorkflow(org._id, 'WF_SAAS_CHANGE');
    const maintenanceWorkflow = await upsertNamedWorkflow(org._id, MAINTENANCE_WORKFLOW_KEY);
    const supportPath = await upsertSupportPath(org._id, workflow);
    await migrateTaxonomy(taxonomy, workflow, supportPath, slaInfo);
    log(`
PROBLEM + CHANGE REQUEST`);
    await bindIssueTypeWorkflow(org._id, taxonomy.family._id, ['Problem'], problemWorkflow);
    await bindIssueTypeWorkflow(org._id, taxonomy.family._id, ['Change Request', 'Change'], changeWorkflow);

    await migrateMaintenanceTaxonomy(maintenance, maintenanceWorkflow);
    await upsertV24ConfigurationStore(org._id, maintenance);

    if (APPLY) {
      const result = await verify(org._id, {
        incidentId: taxonomy.incident._id,
        subtypeIds: [...taxonomy.subtypes.values()].map((item) => item._id)
      });
      const maintenanceResult = await verifyMaintenance(org._id, {
        issueTypeId: maintenance.issueType._id,
        subtypeIds: [...maintenance.subtypes.values()].map((item) => item._id)
      });

      const report = {
        migratedAt: new Date().toISOString(),
        workspace: WORKSPACE,
        organizationId: asId(org._id),
        serviceModelKey: V24_MODEL_KEY,
        version: V24_VERSION,
        workflow: { id: asId(result.workflow._id), key: result.workflow.key },
        supportPath: { id: asId(result.supportPath._id), key: result.supportPath.key },
        incidentIssueTypeId: asId(result.incident._id),
        incidentSlaPolicyId: asId(result.incident.slaPolicyId),
        forms: result.subtypes.map((item) => ({ id: asId(item._id), name: item.name, formDefinitionKey: item.formDefinitionKey })),
        maintenance: {
          issueTypeId: asId(maintenanceResult.issueType._id),
          workflow: { id: asId(maintenanceResult.workflow._id), key: maintenanceResult.workflow.key },
          slaApplicable: maintenanceResult.issueType.slaApplicable,
          forms: maintenanceResult.subtypes.map((item) => ({ id: asId(item._id), name: item.name, formDefinitionKey: item.formDefinitionKey }))
        },
        existingRequestsMigrated: false,
        oldWorkflowsDeleted: false
      };

      const reportFile = path.resolve(process.cwd(), `v24.2.1-migration-${WORKSPACE}-${timestamp()}.json`);
      fs.writeFileSync(reportFile, JSON.stringify(report, null, 2));
      log(`\n✓ Migration applied and verified.`);
      log(`Report: ${reportFile}`);
    } else {
      log(`\nDRY RUN COMPLETE — no writes performed.`);
      log(`If the plan above is correct, run:`);
      log(`  node scripts/migrate-suntecgroup-to-v24.2.1.mjs --workspace=${WORKSPACE} --apply`);
    }

    log(`\nImportant:`);
    log(`  • Existing open requests keep their current embedded workflow snapshots.`);
    log(`  • New Incident/Problem/Change Request/Maintenance Request records use v24.2.1 configuration after migration.`);
    log(`  • Old workflow/path documents are preserved for rollback and audit.`);
    log(`  • Maintenance Request is configured from the supplied JSM workflow and does not use Incident SLA.`);
    log(`  • Existing subtype-specific Maintenance support paths are preserved. Components LOV remains provisioned on Incident subtypes.`);
  } finally {
    await disconnectDatabase();
  }
}

main().catch((error) => {
  console.error(`\nMIGRATION FAILED: ${error.stack || error.message}`);
  process.exitCode = 1;
});
