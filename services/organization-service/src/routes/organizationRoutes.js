import express from 'express';
import mongoose from 'mongoose';
import { Client } from '../models/Client.js';
import { Environment as ServiceEnvironment } from '../models/Environment.js';
import { IssueType } from '../models/IssueType.js';
import { Module } from '../models/Module.js';
import { Organization } from '../models/Organization.js';
import { Priority } from '../models/Priority.js';
import { Product } from '../models/Product.js';
import { Region } from '../models/Region.js';
import { Severity } from '../models/Severity.js';
import { SlaPolicy } from '../models/SlaPolicy.js';
import { Workflow } from '../models/Workflow.js';
import { SupportPath } from '../models/SupportPath.js';
import { Subregion } from '../models/Subregion.js';
import { SavedFilter } from '../models/SavedFilter.js';
import { AuditLog } from '../models/AuditLog.js';

export const organizationRouter = express.Router();

const RESERVED_WORKSPACE_SLUGS = new Set(['admin', 'agent', 'client', 'api', 'assets', 'static', 'login', 'logout', 'health', 'setup', 'session', 'activate', 'reset-password', 'forgot-password']);

function isValidId(value) {
  return mongoose.Types.ObjectId.isValid(String(value || ''));
}

function sanitizeCode(value) {
  return String(value || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 12);
}

function buildCodeFromName(name) {
  const cleanName = String(name || '').trim();
  const words = cleanName.split(/\s+/).filter(Boolean);
  const initials = sanitizeCode(words.map((word) => word[0]).join(''));
  if (words.length > 1 && initials.length >= 2) return initials;
  const compactName = sanitizeCode(cleanName);
  if (compactName.length >= 2) return compactName;
  return 'ORG';
}

function normalizeShortCode(value, fallbackName) {
  const explicitCode = sanitizeCode(value);
  if (explicitCode.length >= 2) return explicitCode;
  return buildCodeFromName(fallbackName);
}

function normalizeWorkspaceSlug(value, fallback) {
  const raw = String(value || fallback || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  const slug = raw || 'workspace';
  return RESERVED_WORKSPACE_SLUGS.has(slug) ? `${slug}-workspace` : slug;
}

async function uniqueWorkspaceSlug(baseSlug, excludeOrganizationId = null) {
  const base = normalizeWorkspaceSlug(baseSlug);
  for (let index = 0; index < 200; index += 1) {
    const suffix = index === 0 ? '' : `-${index + 1}`;
    const candidate = `${base.slice(0, 48 - suffix.length)}${suffix}`;
    const existing = await Organization.findOne({ workspaceSlug: candidate });
    if (!existing || (excludeOrganizationId && String(existing._id) === String(excludeOrganizationId))) return candidate;
  }
  return `${base.slice(0, 41)}-${Date.now().toString().slice(-6)}`;
}

function organizationWorkspaceSlug(organization) {
  return organization.workspaceSlug || normalizeWorkspaceSlug(organization.shortCode || organization.name);
}


function sanitizeClientCode(value) {
  return String(value || '')
    .toUpperCase()
    .replace(/[^A-Z]/g, '')
    .slice(0, 6);
}

function buildClientCodeBase(name) {
  const cleanName = String(name || '').trim().toUpperCase();
  const words = cleanName.match(/[A-Z]+/g) || [];
  let candidate = '';

  if (words.length >= 2) {
    candidate = `${words[0].slice(0, 3)}${words[words.length - 1].slice(0, 3)}`;
  } else if (words.length === 1) {
    candidate = words[0].slice(0, 6);
  }

  candidate = sanitizeClientCode(candidate || cleanName);
  return `${candidate}XXXXXX`.slice(0, 6);
}

function alphaSuffix(index) {
  let value = Number(index) || 0;
  let output = '';
  do {
    output = String.fromCharCode(65 + (value % 26)) + output;
    value = Math.floor(value / 26) - 1;
  } while (value >= 0);
  return output;
}

function clientCodeCandidate(baseCode, attempt) {
  const base = `${sanitizeClientCode(baseCode)}XXXXXX`.slice(0, 6);
  if (!attempt) return base;
  const suffix = alphaSuffix(attempt - 1).slice(0, 6);
  return `${base.slice(0, 6 - suffix.length)}${suffix}`;
}

async function suggestClientCode(organizationId, { name, shortCode, excludeClientId } = {}) {
  const manual = sanitizeClientCode(shortCode);
  const excludedId = isValidId(excludeClientId) ? String(excludeClientId) : null;

  if (manual.length > 0) {
    if (manual.length !== 6) {
      return {
        shortCode: manual,
        available: false,
        message: 'Client short code must be exactly 6 letters.'
      };
    }
    const existing = await Client.findOne({ organizationId, shortCode: manual });
    const available = !existing || (excludedId && String(existing._id) === excludedId);
    return {
      shortCode: manual,
      available,
      message: available ? `${manual} is available.` : `${manual} is already used.`
    };
  }

  const baseCode = buildClientCodeBase(name);
  for (let attempt = 0; attempt < 702; attempt += 1) {
    const candidate = clientCodeCandidate(baseCode, attempt);
    const existing = await Client.findOne({ organizationId, shortCode: candidate });
    if (!existing || (excludedId && String(existing._id) === excludedId)) {
      return {
        shortCode: candidate,
        available: true,
        message: `${candidate} is available.`
      };
    }
  }

  return {
    shortCode: baseCode,
    available: false,
    message: 'No available 6-letter code could be generated. Edit the code manually.'
  };
}

function normalizeClientShortCode(value) {
  const code = sanitizeClientCode(value);
  if (code.length !== 6) {
    const error = new Error('Client short code must be exactly 6 letters.');
    error.status = 400;
    throw error;
  }
  return code;
}

function makeKey(name) {
  const key = String(name || '')
    .trim()
    .toUpperCase()
    .replace(/&/g, ' AND ')
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80);
  return key || 'ITEM';
}


function normalizeConfigCode(value, fallbackName, max = 20) {
  const explicit = String(value || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, max);
  if (explicit) return explicit;
  return makeKey(fallbackName).slice(0, max);
}

function requireText(value, label) {
  const trimmed = String(value || '').trim();
  if (!trimmed) {
    const error = new Error(`${label} is required.`);
    error.status = 400;
    throw error;
  }
  return trimmed;
}

function numberOrNull(value) {
  if (value === '' || value === undefined || value === null) return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function makeStatusId(name, index = 0) {
  const base = String(name || '')
    .trim()
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 34);
  return base || `status_${index + 1}`;
}

function makeUniqueStatusId(name, index, existingIds) {
  const base = makeStatusId(name, index);
  let candidate = base;
  let suffix = 2;
  while (existingIds.has(candidate)) {
    candidate = `${base}_${suffix}`.slice(0, 40);
    suffix += 1;
  }
  existingIds.add(candidate);
  return candidate;
}

async function requireOrganization(organizationId) {
  if (!isValidId(organizationId)) {
    const error = new Error('Invalid organization id.');
    error.status = 400;
    throw error;
  }
  const organization = await Organization.findById(organizationId);
  if (!organization) {
    const error = new Error('Organization not found.');
    error.status = 404;
    throw error;
  }
  return organization;
}



function normalizeCustomFieldKey(value, fallbackLabel = '') {
  const base = String(value || fallbackLabel || '')
    .trim()
    .toUpperCase()
    .replace(/&/g, ' AND ')
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60);
  return base || 'CUSTOM_FIELD';
}

function normalizeCustomField(body = {}, existing = {}) {
  const label = requireText(body.label || existing.label, 'Field label');
  const allowedTypes = new Set(['short_text', 'long_text', 'number', 'date', 'dropdown', 'multi_select', 'checkbox', 'url']);
  const fieldType = allowedTypes.has(String(body.fieldType || existing.fieldType || 'short_text')) ? String(body.fieldType || existing.fieldType || 'short_text') : 'short_text';
  const fieldKey = normalizeCustomFieldKey(body.fieldKey || existing.fieldKey, label);
  const required = body.required === true || body.required === 'true' || body.required === 'on';
  const helpText = String(body.helpText ?? existing.helpText ?? '').trim().slice(0, 260);
  const optionsText = String(body.optionsText ?? existing.optionsText ?? '').trim().slice(0, 1200);
  const displayOrder = Number(body.displayOrder ?? existing.displayOrder ?? 100) || 100;
  const status = body.status === 'inactive' ? 'inactive' : 'active';
  return { fieldKey, label, fieldType, required, helpText, optionsText, displayOrder, status };
}

function uniqueCustomFieldKey(baseKey, existingFields = [], ignoreKey = '') {
  const keys = new Set((existingFields || []).map((field) => String(field.fieldKey || '').toUpperCase()).filter((key) => key && key !== String(ignoreKey || '').toUpperCase()));
  let candidate = normalizeCustomFieldKey(baseKey);
  let index = 2;
  while (keys.has(candidate)) {
    const suffix = `_${index}`;
    candidate = `${normalizeCustomFieldKey(baseKey).slice(0, 60 - suffix.length)}${suffix}`;
    index += 1;
  }
  return candidate;
}

function normalizeIssueTypeFieldsConfig(body = {}, current = {}) {
  const defaults = {
    severity: true,
    priority: true,
    product: true,
    module: true,
    region: true,
    environment: true
  };
  const source = body.fieldsConfig && typeof body.fieldsConfig === 'object' ? body.fieldsConfig : body;
  const result = { ...defaults, ...(current || {}) };
  for (const key of Object.keys(defaults)) {
    if (Object.prototype.hasOwnProperty.call(source, `field_${key}`)) {
      result[key] = source[`field_${key}`] === 'on' || source[`field_${key}`] === true || source[`field_${key}`] === 'true';
    } else if (Object.prototype.hasOwnProperty.call(source, key)) {
      result[key] = source[key] === 'on' || source[key] === true || source[key] === 'true';
    } else if (body.resetMissingFields === true || body.resetMissingFields === 'true') {
      result[key] = false;
    }
  }
  return result;
}

async function createIssueType({ organizationId, level, parentTypeId = null, name, description = '', icon = '◌', displayOrder = 100, fieldsConfig = null, customFields = [], workflowId = null, supportPathId = null, slaApplicable = null, slaPolicyId = null, formDefinitionKey = '', approvalPolicyKey = '', notificationPolicyKey = '' }) {
  const trimmedName = String(name || '').trim();
  const trimmedDescription = String(description || '').trim();

  if (!trimmedName) {
    const error = new Error('Issue type name is required.');
    error.status = 400;
    throw error;
  }

  if (!trimmedDescription) {
    const error = new Error('Issue type description is required.');
    error.status = 400;
    throw error;
  }

  const key = makeKey(trimmedName);
  const existing = await IssueType.findOne({ organizationId, level, parentTypeId, key });
  if (existing) return existing;

  return IssueType.create({
    organizationId,
    level,
    parentTypeId,
    name: trimmedName,
    key,
    description: trimmedDescription,
    icon: String(icon || '◌').trim().slice(0, 8) || '◌',
    workflowId,
    supportPathId,
    slaApplicable: slaApplicable === true || slaApplicable === false ? slaApplicable : null,
    slaPolicyId,
    formDefinitionKey: String(formDefinitionKey || '').trim().toUpperCase(),
    approvalPolicyKey: String(approvalPolicyKey || '').trim().toUpperCase(),
    notificationPolicyKey: String(notificationPolicyKey || '').trim().toUpperCase(),
    fieldsConfig: fieldsConfig || normalizeIssueTypeFieldsConfig({}),
    customFields: Array.isArray(customFields) ? customFields : [],
    displayOrder: Number.isFinite(Number(displayOrder)) ? Number(displayOrder) : 100
  });
}

function enrichTaxonomyNode(node, workflowsById = new Map(), supportPathsById = new Map(), slaPoliciesById = new Map()) {
  const item = typeof node?.toObject === 'function' ? node.toObject() : { ...(node || {}) };
  item.workflow = item.workflowId ? workflowsById.get(String(item.workflowId)) || null : null;
  item.supportPath = item.supportPathId ? supportPathsById.get(String(item.supportPathId)) || null : null;
  item.slaPolicy = item.slaPolicyId ? slaPoliciesById.get(String(item.slaPolicyId)) || null : null;
  item.kind = Number(item.level) === 1 ? 'family' : Number(item.level) === 2 ? 'issueType' : 'subtype';
  return item;
}

function buildTree(types, workflowsById = new Map(), supportPathsById = new Map(), slaPoliciesById = new Map()) {
  const level1 = types.filter((item) => Number(item.level) === 1);
  const level2 = types.filter((item) => Number(item.level) === 2);
  const level3 = types.filter((item) => Number(item.level) === 3);

  return level1.map((family) => ({
    ...enrichTaxonomyNode(family, workflowsById, supportPathsById, slaPoliciesById),
    children: level2
      .filter((issueType) => String(issueType.parentTypeId) === String(family._id))
      .map((issueType) => ({
        ...enrichTaxonomyNode(issueType, workflowsById, supportPathsById, slaPoliciesById),
        children: level3
          .filter((subtype) => String(subtype.parentTypeId) === String(issueType._id))
          .map((subtype) => enrichTaxonomyNode(subtype, workflowsById, supportPathsById, slaPoliciesById))
      }))
  }));
}

function taxonomyLabel(level) {
  if (Number(level) === 1) return 'Family';
  if (Number(level) === 2) return 'Issue Type';
  if (Number(level) === 3) return 'Subtype';
  return 'Taxonomy node';
}

async function validateTaxonomyBehaviorRefs(organizationId, body = {}) {
  const result = { workflowId: null, supportPathId: null, slaPolicyId: null };
  const workflowId = String(body.workflowId || '').trim();
  if (workflowId) {
    if (!isValidId(workflowId)) throw Object.assign(new Error('Invalid workflow id.'), { status: 400 });
    const workflow = await Workflow.findOne({ _id: workflowId, organizationId, status: 'active' });
    if (!workflow) throw Object.assign(new Error('Workflow not found.'), { status: 404 });
    result.workflowId = workflow._id;
  }
  const supportPathId = String(body.supportPathId || '').trim();
  if (supportPathId) {
    if (!isValidId(supportPathId)) throw Object.assign(new Error('Invalid support path id.'), { status: 400 });
    const supportPath = await SupportPath.findOne({ _id: supportPathId, organizationId, status: 'active' });
    if (!supportPath) throw Object.assign(new Error('Support path not found.'), { status: 404 });
    result.supportPathId = supportPath._id;
  }
  const slaPolicyId = String(body.slaPolicyId || '').trim();
  if (slaPolicyId) {
    if (!isValidId(slaPolicyId)) throw Object.assign(new Error('Invalid SLA policy id.'), { status: 400 });
    const policy = await SlaPolicy.findOne({ _id: slaPolicyId, organizationId, status: 'active' });
    if (!policy) throw Object.assign(new Error('SLA policy not found.'), { status: 404 });
    result.slaPolicyId = policy._id;
  }
  return result;
}

function parseStatusesFromText(statusesText) {
  const rawLines = String(statusesText || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const lines = rawLines.length
    ? rawLines
    : [
        'New | New | start',
        'Assigned | Under Review | normal',
        'In Progress | In Progress | normal',
        'Resolved | Resolved | resolved',
        'Closed | Closed | final'
      ];

  const existingIds = new Set();
  return lines.map((line, index) => {
    const parts = line.split('|').map((part) => part.trim());
    const name = parts[0] || `Status ${index + 1}`;
    const customerLabel = parts[1] || name;
    const requestedType = (parts[2] || (index === 0 ? 'start' : 'normal')).toLowerCase();
    const allowedTypes = new Set(['start', 'normal', 'hold', 'waiting', 'resolved', 'final', 'cancelled']);
    const statusType = allowedTypes.has(requestedType) ? requestedType : 'normal';

    return {
      localId: makeUniqueStatusId(name, index, existingIds),
      name,
      description: `${name} stage in this workflow.`,
      customerLabel,
      statusType,
      isCustomerVisible: true,
      displayOrder: (index + 1) * 10
    };
  });
}

function linearTransitionsFor(statuses) {
  return statuses.slice(0, -1).map((status, index) => ({
    fromStatusId: status.localId,
    toStatusId: statuses[index + 1].localId
  }));
}

async function createWorkflow({ organizationId, name, description, statusesText, explicitStatuses, explicitTransitions }) {
  const trimmedName = String(name || '').trim();
  const trimmedDescription = String(description || '').trim();

  if (!trimmedName) {
    const error = new Error('Workflow name is required.');
    error.status = 400;
    throw error;
  }

  if (!trimmedDescription) {
    const error = new Error('Workflow description is required.');
    error.status = 400;
    throw error;
  }

  const key = makeKey(trimmedName);
  const existing = await Workflow.findOne({ organizationId, key });
  if (existing) return existing;

  const statuses = Array.isArray(explicitStatuses) && explicitStatuses.length ? explicitStatuses : parseStatusesFromText(statusesText);
  const statusIds = new Set(statuses.map((status) => status.localId));
  const transitions = Array.isArray(explicitTransitions)
    ? explicitTransitions.filter((transition) => statusIds.has(transition.fromStatusId) && statusIds.has(transition.toStatusId) && transition.fromStatusId !== transition.toStatusId)
    : linearTransitionsFor(statuses);

  return Workflow.create({
    organizationId,
    name: trimmedName,
    key,
    description: trimmedDescription,
    statuses,
    transitions
  });
}

async function getWorkflowsById(organizationId) {
  const workflows = await Workflow.find({ organizationId }).sort({ name: 1 });
  return new Map(workflows.map((workflow) => [String(workflow._id), workflow.toObject()]));
}

async function getSupportPathsById(organizationId) {
  const [supportPaths, workflowsById] = await Promise.all([
    SupportPath.find({ organizationId }).sort({ name: 1 }),
    getWorkflowsById(organizationId)
  ]);
  return new Map(supportPaths.map((path) => [String(path._id), enrichSupportPathWithWorkflows(path, workflowsById)]));
}

async function getSlaPoliciesById(organizationId) {
  const policies = await SlaPolicy.find({ organizationId }).sort({ name: 1 });
  return new Map(policies.map((policy) => [String(policy._id), policy.toObject()]));
}

function enrichSupportPathWithWorkflows(supportPath, workflowsById = new Map()) {
  const item = typeof supportPath.toObject === 'function' ? supportPath.toObject() : { ...(supportPath || {}) };
  item.levels = (item.levels || []).map((level) => {
    const workflow = level.workflowId ? workflowsById.get(String(level.workflowId)) || null : null;
    return {
      ...level,
      workflow,
      workflowDefinition: workflow ? { statuses: workflow.statuses || [], transitions: workflow.transitions || [] } : { statuses: [], transitions: [] }
    };
  });
  return item;
}

async function supportPathUsage(organizationId, supportPathIds = []) {
  const match = { organizationId, level: 2, supportPathId: { $ne: null } };
  if (supportPathIds.length) match.supportPathId = { $in: supportPathIds };
  const issueTypes = await IssueType.find(match).sort({ name: 1 });
  const usage = new Map();
  issueTypes.forEach((issueType) => {
    const supportPathId = String(issueType.supportPathId);
    if (!usage.has(supportPathId)) usage.set(supportPathId, []);
    usage.get(supportPathId).push(issueType.toObject());
  });
  return usage;
}

async function workflowUsage(organizationId, workflowIds = []) {
  const match = { organizationId, level: 2, workflowId: { $ne: null } };
  if (workflowIds.length) match.workflowId = { $in: workflowIds };

  const issueTypes = await IssueType.find(match).sort({ name: 1 });
  const usage = new Map();
  issueTypes.forEach((issueType) => {
    const workflowId = String(issueType.workflowId);
    if (!usage.has(workflowId)) usage.set(workflowId, []);
    usage.get(workflowId).push(issueType.toObject());
  });
  return usage;
}

async function workflowSupportPathUsage(organizationId, workflowIds = []) {
  const workflowIdSet = new Set(workflowIds.map(String));
  const match = { organizationId, 'levels.workflowId': { $ne: null } };
  if (workflowIds.length) match['levels.workflowId'] = { $in: workflowIds };
  const supportPaths = await SupportPath.find(match).sort({ name: 1 });
  const usage = new Map();
  supportPaths.forEach((supportPath) => {
    (supportPath.levels || []).forEach((level) => {
      const workflowId = String(level.workflowId || '');
      if (!workflowId || (workflowIdSet.size && !workflowIdSet.has(workflowId))) return;
      if (!usage.has(workflowId)) usage.set(workflowId, []);
      usage.get(workflowId).push({
        supportPathId: String(supportPath._id),
        supportPathName: supportPath.name,
        levelId: level.localId,
        levelLabel: level.label
      });
    });
  });
  return usage;
}

const presets = {
  product_support: [
    {
      name: 'Issue',
      icon: '!',
      description: 'Something is broken, blocked, wrong, slow, or not behaving as expected.',
      children: ['Production issue', 'Functional issue', 'Performance issue', 'Data issue', 'Integration issue']
    },
    {
      name: 'Change Request',
      icon: '↗',
      description: 'A change, enhancement, workflow update, report change, or business capability request.',
      children: ['Enhancement', 'Workflow change', 'Report change', 'Business configuration change']
    },
    {
      name: 'Query',
      icon: '?',
      description: 'A clarification, how-to question, explanation, or support guidance request.',
      children: ['How-to question', 'Clarification', 'Explanation request', 'Support guidance']
    },
    {
      name: 'Service Request',
      icon: '✓',
      description: 'An operational service such as access, report extract, deployment help, or environment support.',
      children: ['Access request', 'Report request', 'Deployment assistance', 'Environment support']
    }
  ],
  xelerate_saas: [
    {
      name: 'Incident',
      icon: '!',
      description: 'Something is broken, degraded, unavailable, or causing service impact.',
      children: ['Application Incident', 'Security Incident', 'Operational Incident', 'Infrastructure Incident']
    },
    {
      name: 'Service Request',
      icon: '✓',
      description: 'Requests that need approval or action, usually access, report, DR drill, or operational assistance.',
      children: [
        'Application Access and Business Configuration',
        'AWS User Access',
        'Bastion Host Access',
        'Jenkins Access',
        'JIRA Access',
        'Email Access',
        'Privileged Access',
        'Dynamic Reports',
        'DB Data through CICD Pipeline',
        'DR Drill / BCP',
        'Adhoc AWS Environment Start/Stop',
        'Log Level Change to Debug',
        'Firewall Rule Change',
        'File Transfer from AWS Environment',
        'Infra Configuration Change',
        'Deletion of Application Container Image',
        'RDS Snapshot Change'
      ]
    },
    {
      name: 'Maintenance Request',
      icon: '◷',
      description: 'Planned, proactive, emergency, vulnerability, penetration test, release, or DR maintenance activity.',
      children: ['Scheduled Maintenance', 'Proactive Maintenance', 'Emergency Maintenance', 'Vulnerability Run', 'Penetration Test Run', 'Actual DR']
    }
  ]
};

const workflowPresets = {
  normal: {
    name: 'Normal Workflow',
    description: 'Reusable workflow for regular issues, queries, and simple service requests with forward and reopen movement.',
    statuses: [
      ['New', 'New', 'start'],
      ['Assigned', 'Under Review', 'normal'],
      ['In Progress', 'In Progress', 'normal'],
      ['Waiting', 'Waiting for Update', 'waiting'],
      ['Resolved', 'Resolved', 'resolved'],
      ['Closed', 'Closed', 'final']
    ],
    transitions: [
      ['new', 'assigned'],
      ['assigned', 'in_progress'],
      ['assigned', 'new'],
      ['in_progress', 'waiting'],
      ['waiting', 'in_progress'],
      ['in_progress', 'resolved'],
      ['resolved', 'closed'],
      ['resolved', 'in_progress']
    ]
  },
  approval: {
    name: 'Approval Workflow',
    description: 'Reusable workflow for service requests that need information, approval, action, and closure.',
    statuses: [
      ['New', 'New', 'start'],
      ['Need Info', 'Need Information', 'waiting'],
      ['Pending Approval', 'Awaiting Approval', 'waiting'],
      ['Approved', 'Approved', 'normal'],
      ['Active', 'In Progress', 'normal'],
      ['Resolved', 'Resolved', 'resolved'],
      ['Closed', 'Closed', 'final'],
      ['Cancelled', 'Cancelled', 'cancelled']
    ],
    transitions: [
      ['new', 'need_info'],
      ['new', 'pending_approval'],
      ['need_info', 'new'],
      ['pending_approval', 'approved'],
      ['pending_approval', 'need_info'],
      ['pending_approval', 'cancelled'],
      ['approved', 'active'],
      ['active', 'resolved'],
      ['resolved', 'closed'],
      ['resolved', 'active']
    ]
  },
  incident: {
    name: 'Incident Resolution Workflow',
    description: 'Reusable incident workflow with analysis, hold, monitoring, development, release, testing, bank verification, and closure.',
    statuses: [
      ['New', 'New', 'start'],
      ['Assigned', 'Under Review', 'normal'],
      ['Analysis', 'Under Review', 'normal'],
      ['On Hold', 'On Hold', 'hold'],
      ['Under Monitoring', 'Under Monitoring', 'waiting'],
      ['Development', 'In Progress', 'normal'],
      ['Release', 'In Progress', 'normal'],
      ['Testing', 'In Progress', 'normal'],
      ['Bank to Verify', 'Waiting for Your Verification', 'waiting'],
      ['Resolved', 'Resolved', 'resolved'],
      ['Closed', 'Closed', 'final']
    ],
    transitions: [
      ['new', 'assigned'],
      ['assigned', 'analysis'],
      ['analysis', 'on_hold'],
      ['on_hold', 'analysis'],
      ['analysis', 'development'],
      ['analysis', 'under_monitoring'],
      ['under_monitoring', 'analysis'],
      ['development', 'release'],
      ['release', 'testing'],
      ['testing', 'bank_to_verify'],
      ['bank_to_verify', 'resolved'],
      ['bank_to_verify', 'testing'],
      ['testing', 'development'],
      ['resolved', 'closed'],
      ['resolved', 'analysis']
    ]
  },
  maintenance: {
    name: 'Maintenance Approval Workflow',
    description: 'Reusable workflow for scheduled, proactive, emergency, vulnerability, penetration test, and DR maintenance activity.',
    statuses: [
      ['New', 'New', 'start'],
      ['Assigned', 'Under Review', 'normal'],
      ['Need Info', 'Need Information', 'waiting'],
      ['Approved', 'Approved', 'normal'],
      ['Active', 'In Progress', 'normal'],
      ['Report Shared', 'Report Shared', 'normal'],
      ['Closed', 'Closed', 'final'],
      ['On Hold', 'On Hold', 'hold'],
      ['Cancelled', 'Cancelled', 'cancelled']
    ],
    transitions: [
      ['new', 'assigned'],
      ['assigned', 'need_info'],
      ['need_info', 'assigned'],
      ['assigned', 'approved'],
      ['approved', 'active'],
      ['active', 'report_shared'],
      ['active', 'on_hold'],
      ['on_hold', 'active'],
      ['report_shared', 'closed'],
      ['assigned', 'cancelled']
    ]
  }
};

function buildWorkflowPreset(preset) {
  const existingIds = new Set();
  const statuses = preset.statuses.map(([name, customerLabel, statusType], index) => ({
    localId: makeUniqueStatusId(name, index, existingIds),
    name,
    description: `${name} stage in ${preset.name}.`,
    customerLabel,
    statusType,
    isCustomerVisible: true,
    displayOrder: (index + 1) * 10
  }));
  const statusIds = new Set(statuses.map((status) => status.localId));
  const transitions = preset.transitions
    .filter(([fromStatusId, toStatusId]) => statusIds.has(fromStatusId) && statusIds.has(toStatusId))
    .map(([fromStatusId, toStatusId]) => ({ fromStatusId, toStatusId }));

  return { statuses, transitions };
}

organizationRouter.post('/', async (req, res, next) => {
  try {
    const name = req.body.name?.trim();
    const shortCode = normalizeShortCode(req.body.shortCode, name);
    const primaryDomain = req.body.primaryDomain?.trim().toLowerCase() || '';
    const createdBy = req.body.createdBy?.trim().toLowerCase() || '';

    if (!name) return res.status(400).json({ message: 'Organization name is required.' });

    const existing = await Organization.findOne({ shortCode });
    if (existing) {
      const allowPendingReuse = req.body.reusePending === true || req.body.reusePending === 'true';
      if (existing.status === 'pending' && allowPendingReuse) {
        existing.name = name;
        existing.primaryDomain = primaryDomain;
        existing.createdBy = createdBy;
        const requestedSlug = normalizeWorkspaceSlug(req.body.workspaceSlug || existing.workspaceSlug || shortCode || name);
        const slugConflict = await Organization.findOne({ workspaceSlug: requestedSlug, _id: { $ne: existing._id } });
        if (slugConflict) return res.status(409).json({ message: `Workspace slug ${requestedSlug} already exists.` });
        existing.workspaceSlug = requestedSlug;
        await existing.save();
        return res.status(200).json({ organization: { ...existing.toObject(), workspaceSlug: organizationWorkspaceSlug(existing) }, pendingRetry: true });
      }
      return res.status(409).json({ message: `Workspace code ${shortCode} already exists.` });
    }

    const requestedSlug = req.body.workspaceSlug || shortCode || name;
    const workspaceSlug = await uniqueWorkspaceSlug(requestedSlug);
    const status = req.body.status === 'pending' ? 'pending' : (req.body.status === 'inactive' ? 'inactive' : 'active');
    const organization = await Organization.create({ name, shortCode, primaryDomain, workspaceSlug, createdBy, status });
    res.status(201).json({ organization: { ...organization.toObject(), workspaceSlug: organizationWorkspaceSlug(organization) } });
  } catch (error) {
    next(error);
  }
});

organizationRouter.get('/latest', async (req, res, next) => {
  try {
    const organization = await Organization.findOne().sort({ createdAt: -1 });
    if (!organization) return res.status(404).json({ message: 'No organization has been created yet.' });
    res.json({ organization: { ...organization.toObject(), workspaceSlug: organizationWorkspaceSlug(organization) } });
  } catch (error) {
    next(error);
  }
});


organizationRouter.get('/workspace/:workspaceSlug', async (req, res, next) => {
  try {
    const slug = normalizeWorkspaceSlug(req.params.workspaceSlug);
    const shortCode = sanitizeCode(req.params.workspaceSlug);
    const organizations = await Organization.find({ status: 'active' }).sort({ createdAt: -1 });
    const organization = organizations.find((item) => {
      const itemSlug = organizationWorkspaceSlug(item);
      return itemSlug === slug || String(item.shortCode || '').toLowerCase() === slug || String(item.shortCode || '') === shortCode;
    });
    if (!organization) return res.status(404).json({ message: 'Workspace not found.' });
    res.json({ organization: { ...organization.toObject(), workspaceSlug: organizationWorkspaceSlug(organization) } });
  } catch (error) {
    next(error);
  }
});

organizationRouter.get('/:id', async (req, res, next) => {
  try {
    if (!isValidId(req.params.id)) return res.status(400).json({ message: 'Invalid organization id.' });
    const organization = await Organization.findById(req.params.id);
    if (!organization) return res.status(404).json({ message: 'Organization not found.' });
    res.json({ organization: { ...organization.toObject(), workspaceSlug: organizationWorkspaceSlug(organization) } });
  } catch (error) {
    next(error);
  }
});

organizationRouter.delete('/:organizationId/pending', async (req, res, next) => {
  try {
    if (!isValidId(req.params.organizationId)) return res.status(400).json({ message: 'Invalid organization id.' });
    const organization = await Organization.findById(req.params.organizationId);
    if (!organization) return res.status(404).json({ message: 'Organization not found.' });
    if (organization.status !== 'pending') return res.status(409).json({ message: 'Only pending organizations can be removed by setup rollback.' });
    const dependencyCount = await Client.countDocuments({ organizationId: organization._id });
    if (dependencyCount) return res.status(409).json({ message: 'Pending workspace already has client data and cannot be rolled back automatically.' });
    await Organization.deleteOne({ _id: organization._id });
    res.json({ deleted: true });
  } catch (error) { next(error); }
});

organizationRouter.post('/:organizationId/activate', async (req, res, next) => {
  try {
    if (!isValidId(req.params.organizationId)) return res.status(400).json({ message: 'Invalid organization id.' });
    const organization = await Organization.findById(req.params.organizationId);
    if (!organization) return res.status(404).json({ message: 'Organization not found.' });
    if (organization.status === 'inactive') return res.status(409).json({ message: 'Inactive organizations cannot be activated from an invitation link.' });
    organization.status = 'active';
    await organization.save();
    res.json({ organization: { ...organization.toObject(), workspaceSlug: organizationWorkspaceSlug(organization) } });
  } catch (error) {
    next(error);
  }
});

organizationRouter.get('/:organizationId/summary', async (req, res, next) => {
  try {
    const organization = await requireOrganization(req.params.organizationId);
    const [
      level1Count,
      level2Count,
      clientCount,
      workflowCount,
      assignedWorkflowCount,
      supportPathCount,
      assignedSupportPathCount,
      severityCount,
      priorityCount,
      productCount,
      moduleCount,
      regionCount,
      subregionCount,
      environmentCount,
      slaPolicyCount,
      clientSlaCount
    ] = await Promise.all([
      IssueType.countDocuments({ organizationId: organization._id, level: 1 }),
      IssueType.countDocuments({ organizationId: organization._id, level: 2 }),
      Client.countDocuments({ organizationId: organization._id }),
      Workflow.countDocuments({ organizationId: organization._id }),
      IssueType.countDocuments({ organizationId: organization._id, level: 2, workflowId: { $ne: null } }),
      SupportPath.countDocuments({ organizationId: organization._id }),
      IssueType.countDocuments({ organizationId: organization._id, level: 2, supportPathId: { $ne: null } }),
      Severity.countDocuments({ organizationId: organization._id }),
      Priority.countDocuments({ organizationId: organization._id }),
      Product.countDocuments({ organizationId: organization._id }),
      Module.countDocuments({ organizationId: organization._id }),
      Region.countDocuments({ organizationId: organization._id }),
      Subregion.countDocuments({ organizationId: organization._id }),
      ServiceEnvironment.countDocuments({ organizationId: organization._id }),
      SlaPolicy.countDocuments({ organizationId: organization._id }),
      Client.countDocuments({ organizationId: organization._id, defaultSlaPolicyId: { $ne: null } })
    ]);
    res.json({
      summary: {
        level1Count,
        level2Count,
        clientCount,
        workflowCount,
        assignedWorkflowCount,
        supportPathCount,
        assignedSupportPathCount,
        severityCount,
        priorityCount,
        productCount,
        moduleCount,
        regionCount,
        subregionCount,
        environmentCount,
        slaPolicyCount,
        clientSlaCount
      }
    });
  } catch (error) {
    next(error);
  }
});

organizationRouter.get('/:organizationId/issue-types', async (req, res, next) => {
  try {
    const organization = await requireOrganization(req.params.organizationId);
    const [types, workflowsById, supportPathsById, slaPoliciesById] = await Promise.all([
      IssueType.find({ organizationId: organization._id }).sort({ level: 1, displayOrder: 1, name: 1 }),
      getWorkflowsById(organization._id),
      getSupportPathsById(organization._id),
      getSlaPoliciesById(organization._id)
    ]);
    res.json({ taxonomyVersion: '23.1', issueTypes: types, tree: buildTree(types, workflowsById, supportPathsById, slaPoliciesById) });
  } catch (error) {
    next(error);
  }
});

organizationRouter.post('/:organizationId/issue-types/level1', async (req, res, next) => {
  try {
    const organization = await requireOrganization(req.params.organizationId);
    const firstFamily = await IssueType.findOne({ organizationId: organization._id, level: 1 }).sort({ displayOrder: 1, createdAt: -1 });
    const issueType = await createIssueType({
      organizationId: organization._id,
      level: 1,
      name: req.body.name,
      description: req.body.description,
      icon: req.body.icon || '◌',
      displayOrder: firstFamily ? Number(firstFamily.displayOrder || 100) - 10 : 10
    });
    res.status(201).json({ issueType });
  } catch (error) {
    next(error);
  }
});

organizationRouter.post('/:organizationId/issue-types/level2', async (req, res, next) => {
  try {
    const organization = await requireOrganization(req.params.organizationId);
    const parentTypeId = req.body.parentTypeId;
    if (!isValidId(parentTypeId)) return res.status(400).json({ message: 'Valid Family id is required.' });

    const parent = await IssueType.findOne({ _id: parentTypeId, organizationId: organization._id, level: 1 });
    if (!parent) return res.status(404).json({ message: 'Parent Family not found.' });

    const firstIssueType = await IssueType.findOne({ organizationId: organization._id, level: 2, parentTypeId: parent._id }).sort({ displayOrder: 1, createdAt: -1 });
    const issueType = await createIssueType({
      organizationId: organization._id,
      level: 2,
      parentTypeId: parent._id,
      name: req.body.name,
      description: req.body.description,
      icon: '•',
      displayOrder: firstIssueType ? Number(firstIssueType.displayOrder || 100) - 10 : 10,
      fieldsConfig: normalizeIssueTypeFieldsConfig(req.body)
    });
    res.status(201).json({ issueType });
  } catch (error) {
    next(error);
  }
});

organizationRouter.post('/:organizationId/issue-types/level3', async (req, res, next) => {
  try {
    const organization = await requireOrganization(req.params.organizationId);
    const parentTypeId = req.body.parentTypeId;
    if (!isValidId(parentTypeId)) return res.status(400).json({ message: 'Valid Issue Type id is required.' });

    const parent = await IssueType.findOne({ _id: parentTypeId, organizationId: organization._id, level: 2 });
    if (!parent) return res.status(404).json({ message: 'Parent Issue Type not found.' });

    const firstSubtype = await IssueType.findOne({ organizationId: organization._id, level: 3, parentTypeId: parent._id }).sort({ displayOrder: 1, createdAt: -1 });
    const issueType = await createIssueType({
      organizationId: organization._id,
      level: 3,
      parentTypeId: parent._id,
      name: req.body.name,
      description: req.body.description,
      icon: '·',
      displayOrder: firstSubtype ? Number(firstSubtype.displayOrder || 100) - 10 : 10,
      fieldsConfig: normalizeIssueTypeFieldsConfig(req.body)
    });
    res.status(201).json({ issueType });
  } catch (error) {
    next(error);
  }
});


organizationRouter.post('/:organizationId/issue-types/:issueTypeId', async (req, res, next) => {
  try {
    const organization = await requireOrganization(req.params.organizationId);
    if (!isValidId(req.params.issueTypeId)) return res.status(400).json({ message: 'Invalid issue type id.' });
    const issueType = await IssueType.findOne({ _id: req.params.issueTypeId, organizationId: organization._id });
    if (!issueType) return res.status(404).json({ message: 'Issue type not found.' });

    const name = requireText(req.body.name, 'Issue type name');
    const description = requireText(req.body.description, 'Issue type description');
    issueType.name = name;
    issueType.key = makeKey(name);
    issueType.description = description;
    issueType.icon = String(req.body.icon || issueType.icon || '◌').trim().slice(0, 8) || '◌';
    issueType.displayOrder = Number(req.body.displayOrder) || issueType.displayOrder || 100;
    issueType.status = req.body.status === 'inactive' ? 'inactive' : 'active';
    if ([2, 3].includes(Number(issueType.level))) issueType.fieldsConfig = normalizeIssueTypeFieldsConfig(req.body, issueType.fieldsConfig || {});
    await issueType.save();
    res.json({ issueType });
  } catch (error) {
    next(error);
  }
});

organizationRouter.post('/:organizationId/issue-types/:issueTypeId/behavior', async (req, res, next) => {
  try {
    const organization = await requireOrganization(req.params.organizationId);
    if (!isValidId(req.params.issueTypeId)) return res.status(400).json({ message: 'Invalid taxonomy node id.' });
    const node = await IssueType.findOne({ _id: req.params.issueTypeId, organizationId: organization._id, level: { $in: [2, 3] } });
    if (!node) return res.status(404).json({ message: 'Issue Type or Subtype not found.' });

    const refs = await validateTaxonomyBehaviorRefs(organization._id, req.body);
    const update = {
      ...refs,
      slaApplicable: req.body.slaApplicability === 'applicable' ? true : req.body.slaApplicability === 'not_applicable' ? false : null,
      formDefinitionKey: String(req.body.formDefinitionKey || '').trim().toUpperCase().slice(0, 100),
      approvalPolicyKey: String(req.body.approvalPolicyKey || '').trim().toUpperCase().slice(0, 100),
      notificationPolicyKey: String(req.body.notificationPolicyKey || '').trim().toUpperCase().slice(0, 100)
    };
    const updated = await IssueType.findOneAndUpdate(
      { _id: node._id, organizationId: organization._id },
      { $set: update },
      { new: true, runValidators: true }
    );
    res.json({ issueType: updated, kind: taxonomyLabel(updated.level) });
  } catch (error) { next(error); }
});

organizationRouter.post('/:organizationId/issue-types/level2/:issueTypeId/workflow', async (req, res, next) => {
  try {
    const organization = await requireOrganization(req.params.organizationId);
    if (!isValidId(req.params.issueTypeId)) return res.status(400).json({ message: 'Invalid Level 2 issue type id.' });

    const issueType = await IssueType.findOne({ _id: req.params.issueTypeId, organizationId: organization._id, level: 2 });
    if (!issueType) return res.status(404).json({ message: 'Level 2 issue type not found.' });

    const workflowId = String(req.body.workflowId || '');
    const update = {};

    if (!workflowId) {
      update.workflowId = null;
    } else {
      if (!isValidId(workflowId)) return res.status(400).json({ message: 'Invalid workflow id.' });
      const workflow = await Workflow.findOne({ _id: workflowId, organizationId: organization._id, status: 'active' });
      if (!workflow) return res.status(404).json({ message: 'Workflow not found.' });
      update.workflowId = workflow._id;
    }

    // Use a targeted update instead of document.save(). Existing catalogs from older
    // versions may not have mandatory descriptions, and save() validates the full
    // document. Assigning a workflow should only touch workflowId.
    const updatedIssueType = await IssueType.findOneAndUpdate(
      { _id: issueType._id, organizationId: organization._id, level: 2 },
      { $set: update },
      { new: true, runValidators: false }
    );

    res.json({ issueType: updatedIssueType });
  } catch (error) {
    next(error);
  }
});


organizationRouter.post('/:organizationId/issue-types/level2/:issueTypeId/support-path', async (req, res, next) => {
  try {
    const organization = await requireOrganization(req.params.organizationId);
    if (!isValidId(req.params.issueTypeId)) return res.status(400).json({ message: 'Invalid Level 2 issue type id.' });
    const issueType = await IssueType.findOne({ _id: req.params.issueTypeId, organizationId: organization._id, level: 2 });
    if (!issueType) return res.status(404).json({ message: 'Level 2 issue type not found.' });

    const supportPathId = String(req.body.supportPathId || '');
    let value = null;
    if (supportPathId) {
      if (!isValidId(supportPathId)) return res.status(400).json({ message: 'Invalid support path id.' });
      const supportPath = await SupportPath.findOne({ _id: supportPathId, organizationId: organization._id, status: 'active' });
      if (!supportPath) return res.status(404).json({ message: 'Support path not found.' });
      value = supportPath._id;
    }
    const updatedIssueType = await IssueType.findOneAndUpdate(
      { _id: issueType._id, organizationId: organization._id, level: 2 },
      { $set: { supportPathId: value } },
      { new: true, runValidators: false }
    );
    res.json({ issueType: updatedIssueType });
  } catch (error) {
    next(error);
  }
});



organizationRouter.post('/:organizationId/issue-types/:issueTypeId/custom-fields', async (req, res, next) => {
  try {
    const organization = await requireOrganization(req.params.organizationId);
    if (!isValidId(req.params.issueTypeId)) return res.status(400).json({ message: 'Invalid taxonomy node id.' });
    const node = await IssueType.findOne({ _id: req.params.issueTypeId, organizationId: organization._id, level: { $in: [2, 3] } });
    if (!node) return res.status(404).json({ message: 'Issue Type or Subtype not found.' });
    const field = normalizeCustomField(req.body);
    field.fieldKey = uniqueCustomFieldKey(field.fieldKey, node.customFields || []);
    node.customFields.push(field);
    await node.save();
    res.status(201).json({ issueType: node, customField: field });
  } catch (error) { next(error); }
});

organizationRouter.post('/:organizationId/issue-types/:issueTypeId/custom-fields/:fieldKey', async (req, res, next) => {
  try {
    const organization = await requireOrganization(req.params.organizationId);
    if (!isValidId(req.params.issueTypeId)) return res.status(400).json({ message: 'Invalid taxonomy node id.' });
    const node = await IssueType.findOne({ _id: req.params.issueTypeId, organizationId: organization._id, level: { $in: [2, 3] } });
    if (!node) return res.status(404).json({ message: 'Issue Type or Subtype not found.' });
    const fieldKey = String(req.params.fieldKey || '').toUpperCase();
    const index = (node.customFields || []).findIndex((field) => String(field.fieldKey || '').toUpperCase() === fieldKey);
    if (index < 0) return res.status(404).json({ message: 'Custom field not found.' });
    const updated = normalizeCustomField(req.body, node.customFields[index]);
    updated.fieldKey = uniqueCustomFieldKey(updated.fieldKey, node.customFields || [], fieldKey);
    node.customFields[index] = updated;
    await node.save();
    res.json({ issueType: node, customField: updated });
  } catch (error) { next(error); }
});

organizationRouter.post('/:organizationId/issue-types/level2/:issueTypeId/custom-fields', async (req, res, next) => {
  try {
    const organization = await requireOrganization(req.params.organizationId);
    if (!isValidId(req.params.issueTypeId)) return res.status(400).json({ message: 'Invalid Level 2 issue type id.' });
    const issueType = await IssueType.findOne({ _id: req.params.issueTypeId, organizationId: organization._id, level: 2 });
    if (!issueType) return res.status(404).json({ message: 'Level 2 issue type not found.' });
    const field = normalizeCustomField(req.body);
    field.fieldKey = uniqueCustomFieldKey(field.fieldKey, issueType.customFields || []);
    issueType.customFields.push(field);
    await issueType.save();
    res.status(201).json({ issueType, customField: field });
  } catch (error) { next(error); }
});

organizationRouter.post('/:organizationId/issue-types/level2/:issueTypeId/custom-fields/:fieldKey', async (req, res, next) => {
  try {
    const organization = await requireOrganization(req.params.organizationId);
    if (!isValidId(req.params.issueTypeId)) return res.status(400).json({ message: 'Invalid Level 2 issue type id.' });
    const issueType = await IssueType.findOne({ _id: req.params.issueTypeId, organizationId: organization._id, level: 2 });
    if (!issueType) return res.status(404).json({ message: 'Level 2 issue type not found.' });
    const fieldKey = String(req.params.fieldKey || '').toUpperCase();
    const index = (issueType.customFields || []).findIndex((field) => String(field.fieldKey || '').toUpperCase() === fieldKey);
    if (index < 0) return res.status(404).json({ message: 'Custom field not found.' });
    const updated = normalizeCustomField(req.body, issueType.customFields[index]);
    updated.fieldKey = uniqueCustomFieldKey(updated.fieldKey, issueType.customFields || [], fieldKey);
    issueType.customFields[index] = updated;
    await issueType.save();
    res.json({ issueType, customField: updated });
  } catch (error) { next(error); }
});

organizationRouter.post('/:organizationId/issue-types/presets/:presetKey', async (req, res, next) => {
  try {
    const organization = await requireOrganization(req.params.organizationId);
    const preset = presets[req.params.presetKey];
    if (!preset) return res.status(404).json({ message: 'Preset not found.' });

    let createdOrFound = 0;
    for (const [parentIndex, parentItem] of preset.entries()) {
      const parent = await createIssueType({
        organizationId: organization._id,
        level: 1,
        name: parentItem.name,
        description: parentItem.description,
        icon: parentItem.icon,
        displayOrder: (parentIndex + 1) * 10
      });
      createdOrFound += 1;

      for (const [childIndex, childName] of parentItem.children.entries()) {
        await createIssueType({
          organizationId: organization._id,
          level: 2,
          parentTypeId: parent._id,
          name: childName,
          description: `${childName} under ${parentItem.name}.`,
          icon: '•',
          displayOrder: (childIndex + 1) * 10
        });
        createdOrFound += 1;
      }
    }

    const [types, workflowsById, supportPathsById] = await Promise.all([
      IssueType.find({ organizationId: organization._id }).sort({ level: 1, displayOrder: 1, name: 1 }),
      getWorkflowsById(organization._id),
      getSupportPathsById(organization._id)
    ]);
    res.status(201).json({ message: 'Preset applied.', count: createdOrFound, tree: buildTree(types, workflowsById, supportPathsById) });
  } catch (error) {
    next(error);
  }
});

organizationRouter.get('/:organizationId/workflows', async (req, res, next) => {
  try {
    const organization = await requireOrganization(req.params.organizationId);
    const workflows = await Workflow.find({ organizationId: organization._id }).sort({ createdAt: -1 });
    const [usage, supportPathUsage] = await Promise.all([
      workflowUsage(organization._id, workflows.map((workflow) => workflow._id)),
      workflowSupportPathUsage(organization._id, workflows.map((workflow) => workflow._id))
    ]);
    const withUsage = workflows.map((workflow) => {
      const item = workflow.toObject();
      item.usedBy = usage.get(String(workflow._id)) || [];
      item.usedBySupportLevels = supportPathUsage.get(String(workflow._id)) || [];
      item.usageCount = item.usedBy.length + item.usedBySupportLevels.length;
      return item;
    });
    res.json({ workflows: withUsage });
  } catch (error) {
    next(error);
  }
});

organizationRouter.get('/:organizationId/workflows/:workflowId', async (req, res, next) => {
  try {
    const organization = await requireOrganization(req.params.organizationId);
    if (!isValidId(req.params.workflowId)) return res.status(400).json({ message: 'Invalid workflow id.' });
    const workflow = await Workflow.findOne({ _id: req.params.workflowId, organizationId: organization._id });
    if (!workflow) return res.status(404).json({ message: 'Workflow not found.' });

    const [usage, supportPathUsage] = await Promise.all([
      workflowUsage(organization._id, [workflow._id]),
      workflowSupportPathUsage(organization._id, [workflow._id])
    ]);
    const item = workflow.toObject();
    item.usedBy = usage.get(String(workflow._id)) || [];
    item.usedBySupportLevels = supportPathUsage.get(String(workflow._id)) || [];
    item.usageCount = item.usedBy.length + item.usedBySupportLevels.length;
    res.json({ workflow: item });
  } catch (error) {
    next(error);
  }
});

organizationRouter.post('/:organizationId/workflows', async (req, res, next) => {
  try {
    const organization = await requireOrganization(req.params.organizationId);
    const workflow = await createWorkflow({
      organizationId: organization._id,
      name: req.body.name,
      description: req.body.description,
      statusesText: req.body.statusesText
    });
    res.status(201).json({ workflow });
  } catch (error) {
    next(error);
  }
});

organizationRouter.post('/:organizationId/workflows/presets/:presetKey', async (req, res, next) => {
  try {
    const organization = await requireOrganization(req.params.organizationId);
    const preset = workflowPresets[req.params.presetKey];
    if (!preset) return res.status(404).json({ message: 'Workflow preset not found.' });

    const { statuses, transitions } = buildWorkflowPreset(preset);
    const workflow = await createWorkflow({
      organizationId: organization._id,
      name: preset.name,
      description: preset.description,
      explicitStatuses: statuses,
      explicitTransitions: transitions
    });
    res.status(201).json({ workflow });
  } catch (error) {
    next(error);
  }
});



organizationRouter.post('/:organizationId/workflows/:workflowId', async (req, res, next) => {
  try {
    const organization = await requireOrganization(req.params.organizationId);
    if (!isValidId(req.params.workflowId)) return res.status(400).json({ message: 'Invalid workflow id.' });
    const workflow = await Workflow.findOne({ _id: req.params.workflowId, organizationId: organization._id });
    if (!workflow) return res.status(404).json({ message: 'Workflow not found.' });
    const name = requireText(req.body.name, 'Workflow name');
    const description = requireText(req.body.description, 'Workflow description');
    workflow.name = name;
    workflow.key = makeKey(name);
    workflow.description = description;
    workflow.status = req.body.status === 'inactive' ? 'inactive' : 'active';
    await workflow.save();
    res.json({ workflow });
  } catch (error) { next(error); }
});

organizationRouter.post('/:organizationId/workflows/:workflowId/issue-types', async (req, res, next) => {
  try {
    const organization = await requireOrganization(req.params.organizationId);
    if (!isValidId(req.params.workflowId)) return res.status(400).json({ message: 'Invalid workflow id.' });

    const workflow = await Workflow.findOne({ _id: req.params.workflowId, organizationId: organization._id, status: 'active' });
    if (!workflow) return res.status(404).json({ message: 'Workflow not found.' });

    const requestedIds = Array.isArray(req.body.issueTypeIds)
      ? req.body.issueTypeIds
      : req.body.issueTypeIds
        ? [req.body.issueTypeIds]
        : [];

    const validIds = [...new Set(requestedIds.map((id) => String(id || '').trim()).filter(isValidId))];

    // Treat the multi-select as the workflow's exact current assignment list:
    // selected Level 2 types get this workflow, unselected types that currently
    // use this workflow are cleared. This keeps the modal predictable.
    await IssueType.updateMany(
      { organizationId: organization._id, level: 2, workflowId: workflow._id, _id: { $nin: validIds } },
      { $set: { workflowId: null } },
      { runValidators: false }
    );

    if (validIds.length) {
      const validLevel2Types = await IssueType.find({ _id: { $in: validIds }, organizationId: organization._id, level: 2 }).select('_id');
      const assignIds = validLevel2Types.map((item) => item._id);
      await IssueType.updateMany(
        { _id: { $in: assignIds }, organizationId: organization._id, level: 2 },
        { $set: { workflowId: workflow._id } },
        { runValidators: false }
      );
    }

    const usage = await workflowUsage(organization._id, [workflow._id]);
    res.json({ workflowId: workflow._id, assignedIssueTypes: usage.get(String(workflow._id)) || [] });
  } catch (error) {
    next(error);
  }
});

organizationRouter.post('/:organizationId/workflows/:workflowId/statuses', async (req, res, next) => {
  try {
    const organization = await requireOrganization(req.params.organizationId);
    if (!isValidId(req.params.workflowId)) return res.status(400).json({ message: 'Invalid workflow id.' });

    const workflow = await Workflow.findOne({ _id: req.params.workflowId, organizationId: organization._id });
    if (!workflow) return res.status(404).json({ message: 'Workflow not found.' });

    const name = String(req.body.name || '').trim();
    const description = String(req.body.description || '').trim();
    const customerLabel = String(req.body.customerLabel || name).trim();
    if (!name) return res.status(400).json({ message: 'Status name is required.' });
    if (!description) return res.status(400).json({ message: 'Status description is required.' });
    if (!customerLabel) return res.status(400).json({ message: 'Client visible label is required.' });

    const requestedStatusType = ['start', 'normal', 'hold', 'waiting', 'resolved', 'final', 'cancelled'].includes(req.body.statusType) ? req.body.statusType : 'normal';
    if (requestedStatusType === 'start' && workflow.statuses.some((status) => status.isActive !== false && status.statusType === 'start')) {
      return res.status(409).json({ message: 'This workflow already has an active start status. Edit the existing start status first.' });
    }

    const orderedStatuses = [...(workflow.statuses || [])].sort((a, b) => Number(a.displayOrder || 0) - Number(b.displayOrder || 0));
    const insertAfterStatusId = String(req.body.insertAfterStatusId || '').trim();
    const insertBeforeStatusId = String(req.body.insertBeforeStatusId || '').trim();
    const autoConnect = ['true', 'on', '1', 'yes'].includes(String(req.body.autoConnect || '').toLowerCase());
    const afterStatus = orderedStatuses.find((status) => status.localId === insertAfterStatusId) || null;
    let beforeStatus = orderedStatuses.find((status) => status.localId === insertBeforeStatusId) || null;

    if (afterStatus && !beforeStatus) {
      const afterIndex = orderedStatuses.findIndex((status) => status.localId === afterStatus.localId);
      beforeStatus = orderedStatuses[afterIndex + 1] || null;
    }

    const explicitOrder = Number(req.body.displayOrder);
    let displayOrder = Number.isFinite(explicitOrder) && explicitOrder > 0 ? explicitOrder : null;
    if (!displayOrder && afterStatus) {
      let afterOrder = Number(afterStatus.displayOrder || 0);
      let beforeOrder = beforeStatus ? Number(beforeStatus.displayOrder || 0) : null;
      if (beforeStatus && beforeOrder - afterOrder <= 1) {
        orderedStatuses.forEach((status, index) => { status.displayOrder = (index + 1) * 10; });
        afterOrder = Number(afterStatus.displayOrder || 0);
        beforeOrder = Number(beforeStatus.displayOrder || 0);
      }
      displayOrder = beforeStatus ? afterOrder + ((beforeOrder - afterOrder) / 2) : afterOrder + 10;
    }
    if (!displayOrder && beforeStatus) {
      const beforeOrder = Number(beforeStatus.displayOrder || 10);
      displayOrder = Math.max(1, beforeOrder - 5);
    }
    if (!displayOrder) displayOrder = (workflow.statuses.length + 1) * 10;

    const existingIds = new Set(workflow.statuses.map((status) => status.localId));
    const localId = makeUniqueStatusId(name, workflow.statuses.length, existingIds);
    workflow.statuses.push({
      localId,
      name,
      description,
      customerLabel,
      statusType: requestedStatusType,
      isCustomerVisible: req.body.isCustomerVisible !== 'off',
      isActive: true,
      displayOrder
    });

    if (autoConnect && afterStatus) {
      const nextStatus = beforeStatus && beforeStatus.localId !== localId ? beforeStatus : null;
      workflow.transitions = (workflow.transitions || []).filter((transition) => !(nextStatus && transition.fromStatusId === afterStatus.localId && transition.toStatusId === nextStatus.localId));
      const keys = new Set((workflow.transitions || []).map((transition) => `${transition.fromStatusId}__${transition.toStatusId}`));
      const addTransition = (fromStatusId, toStatusId) => {
        const key = `${fromStatusId}__${toStatusId}`;
        if (!fromStatusId || !toStatusId || fromStatusId === toStatusId || keys.has(key)) return;
        workflow.transitions.push({ fromStatusId, toStatusId });
        keys.add(key);
      };
      addTransition(afterStatus.localId, localId);
      if (nextStatus) addTransition(localId, nextStatus.localId);
    }

    await workflow.save();
    res.status(201).json({ workflow, status: workflow.statuses.find((item) => item.localId === localId) });
  } catch (error) {
    next(error);
  }
});


organizationRouter.post('/:organizationId/workflows/:workflowId/statuses/:statusId', async (req, res, next) => {
  try {
    const organization = await requireOrganization(req.params.organizationId);
    if (!isValidId(req.params.workflowId)) return res.status(400).json({ message: 'Invalid workflow id.' });
    const workflow = await Workflow.findOne({ _id: req.params.workflowId, organizationId: organization._id });
    if (!workflow) return res.status(404).json({ message: 'Workflow not found.' });
    const status = workflow.statuses.find((item) => item.localId === String(req.params.statusId || '').trim());
    if (!status) return res.status(404).json({ message: 'Status not found.' });

    const name = requireText(req.body.name || status.name, 'Status name');
    const description = requireText(req.body.description || status.description, 'Status description');
    const customerLabel = requireText(req.body.customerLabel || status.customerLabel || name, 'Client visible label');
    const requestedType = ['start', 'normal', 'hold', 'waiting', 'resolved', 'final', 'cancelled'].includes(req.body.statusType)
      ? req.body.statusType
      : status.statusType || 'normal';
    const isActive = !['false', 'inactive', 'off', '0'].includes(String(req.body.isActive ?? 'true').toLowerCase());

    if (requestedType === 'start' && isActive && workflow.statuses.some((item) => item.localId !== status.localId && item.isActive !== false && item.statusType === 'start')) {
      return res.status(409).json({ message: 'Only one active start status is allowed.' });
    }
    if (!isActive && status.isActive !== false && status.statusType === 'start' && !workflow.statuses.some((item) => item.localId !== status.localId && item.isActive !== false && item.statusType === 'start')) {
      return res.status(409).json({ message: 'Add or designate another start status before deactivating this one.' });
    }

    status.name = name;
    status.description = description;
    status.customerLabel = customerLabel;
    status.statusType = requestedType;
    status.isCustomerVisible = req.body.isCustomerVisible !== 'off';
    status.isActive = isActive;
    status.displayOrder = Number(req.body.displayOrder) || status.displayOrder || 100;
    await workflow.save();
    res.json({ workflow, status });
  } catch (error) { next(error); }
});

organizationRouter.post('/:organizationId/workflows/:workflowId/transitions', async (req, res, next) => {
  try {
    const organization = await requireOrganization(req.params.organizationId);
    if (!isValidId(req.params.workflowId)) return res.status(400).json({ message: 'Invalid workflow id.' });

    const workflow = await Workflow.findOne({ _id: req.params.workflowId, organizationId: organization._id });
    if (!workflow) return res.status(404).json({ message: 'Workflow not found.' });

    const statusIds = new Set(workflow.statuses.map((status) => status.localId));
    const activeStatusIds = new Set(workflow.statuses.filter((status) => status.isActive !== false).map((status) => status.localId));
    const transitionValues = Array.isArray(req.body.transitions)
      ? req.body.transitions
      : req.body.transitions
        ? [req.body.transitions]
        : [];

    // The matrix edits only active statuses. Preserve transitions connected to a
    // deactivated status so historical configuration is never destroyed merely
    // because an administrator saves the active transition map.
    const preservedInactiveTransitions = (workflow.transitions || [])
      .filter((transition) => !activeStatusIds.has(transition.fromStatusId) || !activeStatusIds.has(transition.toStatusId))
      .map((transition) => ({ fromStatusId: transition.fromStatusId, toStatusId: transition.toStatusId }));

    const unique = new Set(preservedInactiveTransitions.map((transition) => `${transition.fromStatusId}__${transition.toStatusId}`));
    const activeTransitions = transitionValues
      .map((value) => String(value || '').split('__'))
      .filter(([fromStatusId, toStatusId]) => activeStatusIds.has(fromStatusId) && activeStatusIds.has(toStatusId) && fromStatusId !== toStatusId)
      .filter(([fromStatusId, toStatusId]) => {
        const key = `${fromStatusId}__${toStatusId}`;
        if (unique.has(key)) return false;
        unique.add(key);
        return true;
      })
      .map(([fromStatusId, toStatusId]) => ({ fromStatusId, toStatusId }));

    workflow.transitions = [...preservedInactiveTransitions, ...activeTransitions]
      .filter((transition) => statusIds.has(transition.fromStatusId) && statusIds.has(transition.toStatusId));

    await workflow.save();
    res.json({ workflow });
  } catch (error) {
    next(error);
  }
});

organizationRouter.post('/:organizationId/workflows/:workflowId/statuses/:statusId/tasks', async (req, res, next) => {
  try {
    const organization = await requireOrganization(req.params.organizationId);
    if (!isValidId(req.params.workflowId)) return res.status(400).json({ message: 'Invalid workflow id.' });
    const workflow = await Workflow.findOne({ _id: req.params.workflowId, organizationId: organization._id });
    if (!workflow) return res.status(404).json({ message: 'Workflow not found.' });
    const status = workflow.statuses.find((item) => item.localId === String(req.params.statusId || '').trim());
    if (!status) return res.status(404).json({ message: 'Status not found.' });
    const title = requireText(req.body.title, 'Task title');
    const localId = `${makeStatusId(title)}_${Date.now().toString(36)}`.slice(0, 60);
    status.taskTemplates = status.taskTemplates || [];
    status.taskTemplates.push({
      localId,
      title,
      description: String(req.body.description || '').trim(),
      ownerSide: ['client', 'partner', 'suntec', 'internal'].includes(req.body.ownerSide) ? req.body.ownerSide : 'suntec',
      queue: String(req.body.queue || '').trim(),
      isBlocking: req.body.isBlocking === true || req.body.isBlocking === 'on',
      visibility: ['client_visible', 'partner_visible', 'internal_only'].includes(req.body.visibility) ? req.body.visibility : 'internal_only',
      displayOrder: Number(req.body.displayOrder) || ((status.taskTemplates || []).length + 1) * 10
    });
    await workflow.save();
    res.status(201).json({ workflow });
  } catch (error) { next(error); }
});



const supportPathPresets = {
  three_level: {
    name: 'Client → Partner → SunTec',
    description: 'Reusable three-level support path for client, partner operations, and SunTec support.',
    levels: [
      { localId: 'L1', label: 'L1 · Client / Bank', ownerSide: 'client', slaApplicable: false, displayOrder: 10 },
      { localId: 'L2', label: 'L2 · Partner / Operations', ownerSide: 'partner', slaApplicable: true, displayOrder: 20 },
      { localId: 'L3', label: 'L3 · SunTec Support', ownerSide: 'suntec', slaApplicable: true, displayOrder: 30 }
    ],
    movementRules: [
      { localId: 'push_l1_l2', actionLabel: 'Push to L2', fromLevelId: 'L1', toLevelId: 'L2', targetStatusBehavior: 'start', commentRequired: true, reasonRequired: true, displayOrder: 10 },
      { localId: 'push_l2_l3', actionLabel: 'Push to L3', fromLevelId: 'L2', toLevelId: 'L3', targetStatusBehavior: 'start', commentRequired: true, reasonRequired: true, displayOrder: 20 }
    ]
  },
  parallel_incident: {
    name: 'Client → L2 + L3 Parallel',
    description: 'Client triage followed by simultaneous L2 operations and L3 SunTec investigation, with L2 as the primary customer-facing stage.',
    levels: [
      { localId: 'L1', label: 'L1 · Client / Service Desk', ownerSide: 'client', slaApplicable: false, displayOrder: 10 },
      { localId: 'L2', label: 'L2 · Partner / Operations', ownerSide: 'partner', slaApplicable: true, displayOrder: 20 },
      { localId: 'L3', label: 'L3 · SunTec Support', ownerSide: 'suntec', slaApplicable: true, displayOrder: 30 }
    ],
    movementRules: [
      { localId: 'push_l1_l2_l3', actionLabel: 'Start L2 + L3', fromLevelId: 'L1', toLevelId: 'L2', toLevelIds: ['L2', 'L3'], primaryLevelId: 'L2', movementType: 'parallel', targetStatusBehavior: 'start', commentRequired: true, reasonRequired: true, displayOrder: 10 }
    ]
  },
  two_level: {
    name: 'Partner → SunTec',
    description: 'Reusable two-level support path where partner operations escalate to SunTec support.',
    levels: [
      { localId: 'L2', label: 'L2 · Partner / Operations', ownerSide: 'partner', slaApplicable: true, displayOrder: 10 },
      { localId: 'L3', label: 'L3 · SunTec Support', ownerSide: 'suntec', slaApplicable: true, displayOrder: 20 }
    ],
    movementRules: [
      { localId: 'push_l2_l3', actionLabel: 'Push to L3', fromLevelId: 'L2', toLevelId: 'L3', targetStatusBehavior: 'start', commentRequired: true, reasonRequired: true, displayOrder: 10 }
    ]
  }
};

async function createSupportPath({ organizationId, name, description, levels = [], movementRules = [] }) {
  const cleanName = requireText(name, 'Support path name');
  const cleanDescription = requireText(description, 'Support path description');
  const key = makeKey(cleanName);
  const existing = await SupportPath.findOne({ organizationId, key });
  if (existing) return existing;
  return SupportPath.create({ organizationId, name: cleanName, key, description: cleanDescription, levels, movementRules });
}

organizationRouter.get('/:organizationId/support-paths', async (req, res, next) => {
  try {
    const organization = await requireOrganization(req.params.organizationId);
    const [supportPaths, workflowsById] = await Promise.all([SupportPath.find({ organizationId: organization._id }).sort({ createdAt: -1 }), getWorkflowsById(organization._id)]);
    const usage = await supportPathUsage(organization._id, supportPaths.map((item) => item._id));
    res.json({ supportPaths: supportPaths.map((item) => ({ ...enrichSupportPathWithWorkflows(item, workflowsById), usedBy: usage.get(String(item._id)) || [], usageCount: (usage.get(String(item._id)) || []).length })) });
  } catch (error) { next(error); }
});

organizationRouter.get('/:organizationId/support-paths/:supportPathId', async (req, res, next) => {
  try {
    const organization = await requireOrganization(req.params.organizationId);
    if (!isValidId(req.params.supportPathId)) return res.status(400).json({ message: 'Invalid support path id.' });
    const [supportPath, workflowsById] = await Promise.all([SupportPath.findOne({ _id: req.params.supportPathId, organizationId: organization._id }), getWorkflowsById(organization._id)]);
    if (!supportPath) return res.status(404).json({ message: 'Support path not found.' });
    const usage = await supportPathUsage(organization._id, [supportPath._id]);
    res.json({ supportPath: { ...enrichSupportPathWithWorkflows(supportPath, workflowsById), usedBy: usage.get(String(supportPath._id)) || [], usageCount: (usage.get(String(supportPath._id)) || []).length } });
  } catch (error) { next(error); }
});

organizationRouter.post('/:organizationId/support-paths', async (req, res, next) => {
  try {
    const organization = await requireOrganization(req.params.organizationId);
    const supportPath = await createSupportPath({
      organizationId: organization._id,
      name: req.body.name,
      description: req.body.description,
      levels: Array.isArray(req.body.levels) ? req.body.levels : [],
      movementRules: Array.isArray(req.body.movementRules) ? req.body.movementRules : []
    });
    res.status(201).json({ supportPath });
  } catch (error) { next(error); }
});

organizationRouter.post('/:organizationId/support-paths/presets/:presetKey', async (req, res, next) => {
  try {
    const organization = await requireOrganization(req.params.organizationId);
    const preset = supportPathPresets[req.params.presetKey];
    if (!preset) return res.status(404).json({ message: 'Support path preset not found.' });
    const supportPath = await createSupportPath({ organizationId: organization._id, ...preset });
    res.status(201).json({ supportPath });
  } catch (error) { next(error); }
});


organizationRouter.post('/:organizationId/support-paths/:supportPathId', async (req, res, next) => {
  try {
    const organization = await requireOrganization(req.params.organizationId);
    if (!isValidId(req.params.supportPathId)) return res.status(400).json({ message: 'Invalid support path id.' });
    const supportPath = await SupportPath.findOne({ _id: req.params.supportPathId, organizationId: organization._id });
    if (!supportPath) return res.status(404).json({ message: 'Support path not found.' });
    const name = requireText(req.body.name, 'Support path name');
    const description = requireText(req.body.description, 'Support path description');
    supportPath.name = name;
    supportPath.key = makeKey(name);
    supportPath.description = description;
    supportPath.status = req.body.status === 'inactive' ? 'inactive' : 'active';
    await supportPath.save();
    res.json({ supportPath });
  } catch (error) { next(error); }
});

organizationRouter.post('/:organizationId/support-paths/:supportPathId/levels', async (req, res, next) => {
  try {
    const organization = await requireOrganization(req.params.organizationId);
    const supportPath = await SupportPath.findOne({ _id: req.params.supportPathId, organizationId: organization._id });
    if (!supportPath) return res.status(404).json({ message: 'Support path not found.' });
    const localId = String(req.body.localId || '').trim().toUpperCase();
    const label = requireText(req.body.label, 'Level label');
    if (!['L1','L2','L3'].includes(localId)) return res.status(400).json({ message: 'Level must be L1, L2, or L3.' });
    if (supportPath.levels.some((item) => item.localId === localId)) return res.status(409).json({ message: `${localId} already exists in this support path.` });
    let workflowId = null;
    let workflowName = '';
    if (isValidId(req.body.workflowId)) {
      const workflow = await Workflow.findOne({ _id: req.body.workflowId, organizationId: organization._id, status: 'active' });
      if (!workflow) return res.status(404).json({ message: 'Workflow not found.' });
      workflowId = workflow._id;
      workflowName = workflow.name;
    }
    supportPath.levels.push({ localId, label, ownerSide: ['client','partner','suntec'].includes(req.body.ownerSide) ? req.body.ownerSide : 'client', slaApplicable: req.body.slaApplicable === true || req.body.slaApplicable === 'on', displayOrder: Number(req.body.displayOrder) || (supportPath.levels.length + 1) * 10, workflowId, workflowName });
    await supportPath.save();
    res.status(201).json({ supportPath });
  } catch (error) { next(error); }
});


organizationRouter.post('/:organizationId/support-paths/:supportPathId/levels/:levelId', async (req, res, next) => {
  try {
    const organization = await requireOrganization(req.params.organizationId);
    const supportPath = await SupportPath.findOne({ _id: req.params.supportPathId, organizationId: organization._id });
    if (!supportPath) return res.status(404).json({ message: 'Support path not found.' });
    const levelId = String(req.params.levelId || '').trim().toUpperCase();
    const index = supportPath.levels.findIndex((item) => item.localId === levelId);
    if (index < 0) return res.status(404).json({ message: 'Support level not found.' });
    supportPath.levels[index].label = requireText(req.body.label || supportPath.levels[index].label, 'Level label');
    supportPath.levels[index].ownerSide = ['client','partner','suntec'].includes(req.body.ownerSide) ? req.body.ownerSide : supportPath.levels[index].ownerSide;
    supportPath.levels[index].slaApplicable = req.body.slaApplicable === true || req.body.slaApplicable === 'on' || req.body.slaApplicable === 'true';
    supportPath.levels[index].displayOrder = Number(req.body.displayOrder) || supportPath.levels[index].displayOrder || 100;
    await supportPath.save();
    res.json({ supportPath });
  } catch (error) { next(error); }
});

organizationRouter.post('/:organizationId/support-paths/:supportPathId/levels/:levelId/workflow', async (req, res, next) => {
  try {
    const organization = await requireOrganization(req.params.organizationId);
    const supportPath = await SupportPath.findOne({ _id: req.params.supportPathId, organizationId: organization._id });
    if (!supportPath) return res.status(404).json({ message: 'Support path not found.' });
    const level = supportPath.levels.find((item) => item.localId === String(req.params.levelId || '').trim());
    if (!level) return res.status(404).json({ message: 'Support level not found.' });
    const workflowId = String(req.body.workflowId || '').trim();
    if (!workflowId) {
      level.workflowId = null;
      level.workflowName = '';
    } else {
      if (!isValidId(workflowId)) return res.status(400).json({ message: 'Invalid workflow id.' });
      const workflow = await Workflow.findOne({ _id: workflowId, organizationId: organization._id, status: 'active' });
      if (!workflow) return res.status(404).json({ message: 'Workflow not found.' });
      level.workflowId = workflow._id;
      level.workflowName = workflow.name;
    }
    await supportPath.save();
    res.json({ supportPath });
  } catch (error) { next(error); }
});

organizationRouter.post('/:organizationId/support-paths/:supportPathId/rules', async (req, res, next) => {
  try {
    const organization = await requireOrganization(req.params.organizationId);
    const supportPath = await SupportPath.findOne({ _id: req.params.supportPathId, organizationId: organization._id });
    if (!supportPath) return res.status(404).json({ message: 'Support path not found.' });
    const fromLevelId = String(req.body.fromLevelId || '').trim();
    const toLevelId = String(req.body.toLevelId || '').trim();
    const levelIds = new Set(supportPath.levels.map((item) => item.localId));
    if (!levelIds.has(fromLevelId)) return res.status(400).json({ message: 'Choose a valid source support level.' });
    const actionLabel = requireText(req.body.actionLabel, 'Action label');
    const requestedToIds = Array.isArray(req.body.toLevelIds) ? req.body.toLevelIds : (req.body.toLevelIds ? [req.body.toLevelIds] : [toLevelId]);
    const cleanToLevelIds = [...new Set(requestedToIds.map((item) => String(item || '').trim()).filter((item) => levelIds.has(item) && item !== fromLevelId))];
    if (!cleanToLevelIds.length) return res.status(400).json({ message: 'Choose at least one target support level different from the source.' });
    const localId = `${makeStatusId(actionLabel)}_${fromLevelId.toLowerCase()}_${cleanToLevelIds.join('_').toLowerCase()}`.slice(0, 50);
    supportPath.movementRules = supportPath.movementRules.filter((item) => item.localId !== localId);
    const movementType = cleanToLevelIds.length > 1 || req.body.movementType === 'parallel' ? 'parallel' : 'sequential';
    const requestedPrimaryLevelId = String(req.body.primaryLevelId || '').trim();
    const primaryLevelId = cleanToLevelIds.includes(requestedPrimaryLevelId) ? requestedPrimaryLevelId : (cleanToLevelIds[0] || toLevelId);
    supportPath.movementRules.push({ localId, actionLabel, fromLevelId, toLevelId: cleanToLevelIds[0] || toLevelId, toLevelIds: cleanToLevelIds.length ? cleanToLevelIds : [toLevelId], primaryLevelId, movementType, targetStatusBehavior: req.body.targetStatusBehavior === 'keep' ? 'keep' : 'start', commentRequired: req.body.commentRequired !== false && req.body.commentRequired !== 'off', reasonRequired: req.body.reasonRequired !== false && req.body.reasonRequired !== 'off', displayOrder: Number(req.body.displayOrder) || (supportPath.movementRules.length + 1) * 10 });
    await supportPath.save();
    res.status(201).json({ supportPath });
  } catch (error) { next(error); }
});

organizationRouter.post('/:organizationId/clients/:clientId/operational-rules', async (req, res, next) => {
  try {
    const organization = await requireOrganization(req.params.organizationId);
    if (!isValidId(req.params.clientId)) return res.status(400).json({ message: 'Invalid client id.' });
    const client = await Client.findOne({ _id: req.params.clientId, organizationId: organization._id });
    if (!client) return res.status(404).json({ message: 'Client not found.' });
    const level2TypeId = String(req.body.level2TypeId || '').trim();
    const supportPathId = String(req.body.supportPathId || '').trim();
    if (!isValidId(level2TypeId) || !isValidId(supportPathId)) return res.status(400).json({ message: 'Choose a request subtype and support path.' });
    const [level2Type, supportPath] = await Promise.all([
      IssueType.findOne({ _id: level2TypeId, organizationId: organization._id, level: 2, status: 'active' }),
      SupportPath.findOne({ _id: supportPathId, organizationId: organization._id, status: 'active' })
    ]);
    if (!level2Type) return res.status(404).json({ message: 'Request subtype not found.' });
    if (!supportPath) return res.status(404).json({ message: 'Support path not found.' });
    const allowedFamilyIds = new Set(await resolveEffectiveClientIssueFamilyIds(client, organization._id));
    if (!allowedFamilyIds.has(String(level2Type.parentTypeId || ''))) {
      return res.status(400).json({ message: 'This request subtype belongs to an Issue Family that is not enabled for this client.' });
    }
    const submittedSeverityIds = [...new Set(Array.isArray(req.body.severityIds) ? req.body.severityIds : req.body.severityIds ? [req.body.severityIds] : [])].map(String).filter(Boolean).sort();
    const submittedEnvironmentIds = [...new Set(Array.isArray(req.body.environmentIds) ? req.body.environmentIds : req.body.environmentIds ? [req.body.environmentIds] : [])].map(String).filter(Boolean).sort();
    if (submittedSeverityIds.some((id) => !isValidId(id)) || submittedEnvironmentIds.some((id) => !isValidId(id))) return res.status(400).json({ message: 'One or more rule conditions are invalid.' });
    const [validSeverities, validEnvironments] = await Promise.all([
      Severity.find({ organizationId: organization._id, _id: { $in: submittedSeverityIds } }).select('_id'),
      ServiceEnvironment.find({ organizationId: organization._id, _id: { $in: submittedEnvironmentIds } }).select('_id')
    ]);
    if (validSeverities.length !== submittedSeverityIds.length || validEnvironments.length !== submittedEnvironmentIds.length) return res.status(400).json({ message: 'One or more rule conditions do not belong to this organization.' });
    const severityIds = validSeverities.map((item) => String(item._id)).sort();
    const environmentIds = validEnvironments.map((item) => String(item._id)).sort();
    const sameConditions = (rule) => {
      const existingSeverityIds = (rule.severityIds || []).map(String).sort();
      const existingEnvironmentIds = (rule.environmentIds || []).map(String).sort();
      return String(rule.level2TypeId) === String(level2Type._id)
        && existingSeverityIds.join(',') === severityIds.join(',')
        && existingEnvironmentIds.join(',') === environmentIds.join(',');
    };
    const previous = (client.operationalRules || []).find(sameConditions);
    const localId = previous?.localId || `rule_${Date.now().toString(36)}`;
    client.operationalRules = (client.operationalRules || []).filter((rule) => !sameConditions(rule));
    const inheritToChildren = req.body.inheritToChildren === true || req.body.inheritToChildren === 'true' || req.body.inheritToChildren === 'on';
    const isActive = req.body.isActive === undefined || req.body.isActive === true || req.body.isActive === 'true' || req.body.isActive === 'on';
    client.operationalRules.push({ localId, level2TypeId: level2Type._id, supportPathId: supportPath._id, severityIds, environmentIds, inheritToChildren, isActive });
    await client.save();
    res.status(201).json({ client });
  } catch (error) { next(error); }
});

const configPresets = {
  severities: [
    { code: 'S1', name: 'Critical', marker: 'critical', displayOrder: 10, description: 'The system cannot be used; critical production impact; immediate resolution is required.' },
    { code: 'S2', name: 'Serious', marker: 'high', displayOrder: 20, description: 'The software is operational but under extreme restriction and needs correction as soon as possible.' },
    { code: 'S3', name: 'Moderate', marker: 'medium', displayOrder: 30, description: 'The software is operational under restrictions; the problem can be avoided or ignored but recurs.' },
    { code: 'S4', name: 'Minor', marker: 'low', displayOrder: 40, description: 'Incorrect behavior with no significant impact on operations.' }
  ],
  priorities: [
    { code: 'P1', name: 'Critical', marker: 'critical', displayOrder: 10, description: 'Highest urgency; act immediately because business priority is critical.' },
    { code: 'P2', name: 'High', marker: 'high', displayOrder: 20, description: 'High urgency; important request requiring quick movement.' },
    { code: 'P3', name: 'Medium', marker: 'medium', displayOrder: 30, description: 'Normal urgency; handle within the planned operational queue.' },
    { code: 'P4', name: 'Low', marker: 'low', displayOrder: 40, description: 'Low urgency; can be handled as capacity allows.' }
  ],
  environments: [
    { code: 'BUILD', name: 'Build', environmentType: 'non_production', slaApplicableByDefault: false, displayOrder: 10, description: 'Build environment used for early validation and development-level checks.' },
    { code: 'SIT', name: 'SIT / Quality', environmentType: 'non_production', slaApplicableByDefault: false, displayOrder: 20, description: 'System integration or quality environment used before staging.' },
    { code: 'STAGE', name: 'Stage', environmentType: 'non_production', slaApplicableByDefault: false, displayOrder: 30, description: 'Staging environment used for internal SaaS or pre-release verification.' },
    { code: 'PREPROD', name: 'Preproduction', environmentType: 'production_like', slaApplicableByDefault: false, displayOrder: 40, description: 'Production-like environment; SLA applicability can be enabled per client or policy.' },
    { code: 'PROD', name: 'Production', environmentType: 'production', slaApplicableByDefault: true, displayOrder: 50, description: 'Production environment; SLA is normally applicable.' },
    { code: 'DR', name: 'DR', environmentType: 'dr', slaApplicableByDefault: true, displayOrder: 60, description: 'Disaster recovery environment; SLA is normally applicable.' }
  ],
  regions: [
    { code: 'INDIA', name: 'India', timezone: 'Asia/Kolkata', description: 'India region and operating timezone.' },
    { code: 'MEA', name: 'Middle East', timezone: 'Asia/Dubai', description: 'Middle East region and operating timezone.' },
    { code: 'EUROPE', name: 'Europe', timezone: 'Europe/London', description: 'Europe region and operating timezone.' },
    { code: 'APAC', name: 'APAC', timezone: 'Asia/Singapore', description: 'APAC region and operating timezone.' },
    { code: 'NA', name: 'North America', timezone: 'America/New_York', description: 'North America region and operating timezone.' }
  ],
  products: [
    {
      code: 'XELERATE',
      name: 'Xelerate',
      description: 'Xelerate SaaS product family.',
      modules: [
        { code: 'UI', name: 'User Interface', description: 'Screens, navigation, forms, usability, and front-end behavior.' },
        { code: 'BATCH', name: 'Batch Processing', description: 'Scheduled jobs, batch flows, and back-office processing.' },
        { code: 'API', name: 'API Process', description: 'APIs, integrations, service calls, and interface processing.' },
        { code: 'CUSTOMER', name: 'Customer / Account', description: 'Customer, account, and related master or operational data.' },
        { code: 'PRICING', name: 'Pricing', description: 'Pricing rules, computations, and pricing outputs.' },
        { code: 'DEAL', name: 'Deal', description: 'Deal configuration, deal lifecycle, and deal calculations.' },
        { code: 'OUTBOUND', name: 'Outbound', description: 'Outbound files, notifications, reports, and external movement.' }
      ]
    }
  ]
};

const slaPresets = {
  silver: {
    name: 'Silver - Standard SLA',
    description: 'Standard SLA support plan with business-hour response and resolution commitments.',
    supportWindow: 'business_hours',
    clockStartTrigger: 'severity_selected',
    rules: [
      { code: 'S1', responseTimeValue: 2, responseTimeUnit: 'business_hours', resolutionTimeValue: 48, resolutionTimeUnit: 'hours', updateFrequencyValue: 1, updateFrequencyUnit: 'daily', clockType: 'working_hours', notes: 'Daily status update.' },
      { code: 'S2', responseTimeValue: 4, responseTimeUnit: 'business_hours', resolutionTimeValue: 96, resolutionTimeUnit: 'hours', updateFrequencyValue: 1, updateFrequencyUnit: 'daily', clockType: 'working_hours', notes: 'Daily status update.' },
      { code: 'S3', responseTimeValue: 3, responseTimeUnit: 'business_days', resolutionTimeValue: 12, resolutionTimeUnit: 'business_days', updateFrequencyValue: null, updateFrequencyUnit: 'periodic', clockType: 'working_hours', notes: 'Through periodic project update.' },
      { code: 'S4', responseTimeValue: 10, responseTimeUnit: 'business_days', resolutionTimeValue: null, resolutionTimeUnit: 'none', updateFrequencyValue: null, updateFrequencyUnit: 'periodic', clockType: 'working_hours', notes: 'Resolution not committed; periodic update.' }
    ]
  },
  gold: {
    name: 'Gold - Expedited SLA',
    description: 'Expedited SLA support plan with faster commitments and 24x7 attention for S1 issues.',
    supportWindow: 'mixed',
    clockStartTrigger: 'severity_selected',
    rules: [
      { code: 'S1', responseTimeValue: 1, responseTimeUnit: 'hours', resolutionTimeValue: 24, resolutionTimeUnit: 'hours', updateFrequencyValue: 4, updateFrequencyUnit: 'hours', clockType: 'calendar', notes: 'Every 4 hours, if required.' },
      { code: 'S2', responseTimeValue: 2, responseTimeUnit: 'business_hours', resolutionTimeValue: 72, resolutionTimeUnit: 'hours', updateFrequencyValue: 1, updateFrequencyUnit: 'daily', clockType: 'working_hours', notes: 'Daily status update.' },
      { code: 'S3', responseTimeValue: 2, responseTimeUnit: 'business_days', resolutionTimeValue: 10, resolutionTimeUnit: 'business_days', updateFrequencyValue: null, updateFrequencyUnit: 'periodic', clockType: 'working_hours', notes: 'Through periodic project update.' },
      { code: 'S4', responseTimeValue: 8, responseTimeUnit: 'business_days', resolutionTimeValue: null, resolutionTimeUnit: 'none', updateFrequencyValue: null, updateFrequencyUnit: 'periodic', clockType: 'working_hours', notes: 'Resolution not committed; periodic update.' }
    ]
  },
  platinum: {
    name: 'Platinum - Expedited SLA',
    description: 'Premium expedited SLA support plan with the shortest commitments and 24x7 attention for S1 and S2 issues.',
    supportWindow: 'mixed',
    clockStartTrigger: 'severity_selected',
    rules: [
      { code: 'S1', responseTimeValue: 0.5, responseTimeUnit: 'hours', resolutionTimeValue: 12, resolutionTimeUnit: 'hours', updateFrequencyValue: 2, updateFrequencyUnit: 'hours', clockType: 'calendar', notes: 'Every 2 hours, if required.' },
      { code: 'S2', responseTimeValue: 1, responseTimeUnit: 'hours', resolutionTimeValue: 48, resolutionTimeUnit: 'hours', updateFrequencyValue: 2, updateFrequencyUnit: 'twice_daily', clockType: 'calendar', notes: 'Twice a day.' },
      { code: 'S3', responseTimeValue: 1, responseTimeUnit: 'business_days', resolutionTimeValue: 8, resolutionTimeUnit: 'business_days', updateFrequencyValue: null, updateFrequencyUnit: 'periodic', clockType: 'working_hours', notes: 'Through periodic project update.' },
      { code: 'S4', responseTimeValue: 6, responseTimeUnit: 'business_days', resolutionTimeValue: null, resolutionTimeUnit: 'none', updateFrequencyValue: null, updateFrequencyUnit: 'periodic', clockType: 'working_hours', notes: 'Resolution not committed; periodic update.' }
    ]
  }
};

function decorateSla(policy, severityMap = new Map(), priorityMap = new Map()) {
  const item = policy.toObject ? policy.toObject() : policy;
  item.rules = (item.rules || []).map((rule) => ({
    ...rule,
    severity: rule.severityId ? severityMap.get(String(rule.severityId)) || null : null,
    priority: rule.priorityId ? priorityMap.get(String(rule.priorityId)) || null : null
  }));
  return item;
}

async function getConfigBundle(organizationId) {
  const [severities, priorities, products, modules, regions, subregions, environments, slaPolicies, clients] = await Promise.all([
    Severity.find({ organizationId }).sort({ displayOrder: 1, code: 1 }),
    Priority.find({ organizationId }).sort({ displayOrder: 1, code: 1 }),
    Product.find({ organizationId }).sort({ name: 1 }),
    Module.find({ organizationId }).sort({ productId: 1, name: 1 }),
    Region.find({ organizationId }).sort({ name: 1 }),
    Subregion.find({ organizationId }).sort({ regionId: 1, name: 1 }),
    ServiceEnvironment.find({ organizationId }).sort({ displayOrder: 1, code: 1 }),
    SlaPolicy.find({ organizationId }).sort({ createdAt: -1 }),
    Client.find({ organizationId }).sort({ name: 1 })
  ]);

  const severityMap = new Map(severities.map((item) => [String(item._id), item.toObject()]));
  const priorityMap = new Map(priorities.map((item) => [String(item._id), item.toObject()]));
  const productMap = new Map(products.map((item) => [String(item._id), { ...item.toObject(), modules: [] }]));
  modules.forEach((module) => {
    const parent = productMap.get(String(module.productId));
    if (parent) parent.modules.push(module.toObject());
  });
  const clientUsage = new Map();
  clients.forEach((client) => {
    if (!client.defaultSlaPolicyId) return;
    const key = String(client.defaultSlaPolicyId);
    if (!clientUsage.has(key)) clientUsage.set(key, []);
    clientUsage.get(key).push(client.toObject());
  });

  const decoratedPolicies = slaPolicies.map((policy) => {
    const item = decorateSla(policy, severityMap, priorityMap);
    item.usedByClients = clientUsage.get(String(policy._id)) || [];
    item.clientUsageCount = item.usedByClients.length;
    return item;
  });

  return {
    severities: severities.map((item) => item.toObject()),
    priorities: priorities.map((item) => item.toObject()),
    products: [...productMap.values()],
    modules: modules.map((item) => item.toObject()),
    regions: regions.map((item) => item.toObject()),
    subregions: subregions.map((item) => item.toObject()),
    environments: environments.map((item) => item.toObject()),
    slaPolicies: decoratedPolicies,
    clients: clients.map((client) => {
      const item = client.toObject();
      item.defaultSlaPolicy = item.defaultSlaPolicyId ? decoratedPolicies.find((policy) => String(policy._id) === String(item.defaultSlaPolicyId)) || null : null;
      return item;
    })
  };
}

async function createSeverity(organizationId, body) {
  const name = requireText(body.name, 'Severity name');
  const description = requireText(body.description, 'Severity description');
  const code = normalizeConfigCode(body.code, name, 12);
  const existing = await Severity.findOne({ organizationId, code });
  if (existing) { const error = new Error(`Severity code ${code} already exists.`); error.status = 409; throw error; }
  return Severity.create({ organizationId, code, name, description, marker: body.marker || '', displayOrder: Number(body.displayOrder) || 100 });
}

async function createPriority(organizationId, body) {
  const name = requireText(body.name, 'Priority name');
  const description = requireText(body.description, 'Priority description');
  const code = normalizeConfigCode(body.code, name, 12);
  const existing = await Priority.findOne({ organizationId, code });
  if (existing) { const error = new Error(`Priority code ${code} already exists.`); error.status = 409; throw error; }
  return Priority.create({ organizationId, code, name, description, marker: body.marker || '', displayOrder: Number(body.displayOrder) || 100 });
}

async function createProduct(organizationId, body) {
  const name = requireText(body.name, 'Product name');
  const description = requireText(body.description, 'Product description');
  const code = normalizeConfigCode(body.code, name, 20);
  const existing = await Product.findOne({ organizationId, code });
  if (existing) { const error = new Error(`Product code ${code} already exists.`); error.status = 409; throw error; }
  return Product.create({ organizationId, code, name, description });
}

async function createModule(organizationId, body) {
  const name = requireText(body.name, 'Module name');
  const description = requireText(body.description, 'Module description');
  const productId = String(body.productId || '');
  if (!isValidId(productId)) {
    const error = new Error('Valid product is required.');
    error.status = 400;
    throw error;
  }
  const product = await Product.findOne({ _id: productId, organizationId });
  if (!product) {
    const error = new Error('Product not found.');
    error.status = 404;
    throw error;
  }
  const code = normalizeConfigCode(body.code, name, 20);
  const existing = await Module.findOne({ organizationId, productId: product._id, code });
  if (existing) { const error = new Error(`Module code ${code} already exists for ${product.name}.`); error.status = 409; throw error; }
  return Module.create({ organizationId, productId: product._id, code, name, description });
}

async function createRegion(organizationId, body) {
  const name = requireText(body.name, 'Region name');
  const description = requireText(body.description, 'Region description');
  const timezone = requireText(body.timezone, 'Timezone');
  const code = normalizeConfigCode(body.code, name, 20);
  if (code.length < 2) { const error = new Error('Region code must be at least 2 characters.'); error.status = 400; throw error; }
  const existing = await Region.findOne({ organizationId, code });
  if (existing) { const error = new Error(`Region code ${code} already exists.`); error.status = 409; throw error; }
  return Region.create({ organizationId, code, name, description, timezone });
}

async function createSubregion(organizationId, body) {
  const name = requireText(body.name, 'Subregion name');
  const regionId = String(body.regionId || '');
  if (!isValidId(regionId)) { const error = new Error('Valid region is required.'); error.status = 400; throw error; }
  const region = await Region.findOne({ _id: regionId, organizationId, status: 'active' });
  if (!region) { const error = new Error('Region not found.'); error.status = 404; throw error; }
  const code = normalizeConfigCode(body.code, name, 20);
  if (code.length < 2) { const error = new Error('Subregion code must be at least 2 characters.'); error.status = 400; throw error; }
  const existing = await Subregion.findOne({ organizationId, regionId: region._id, code });
  if (existing) { const error = new Error(`Subregion code ${code} already exists in ${region.name}.`); error.status = 409; throw error; }
  return Subregion.create({ organizationId, regionId: region._id, code, name, description: String(body.description || '').trim(), timezone: String(body.timezone || '').trim() });
}

async function createEnvironment(organizationId, body) {
  const name = requireText(body.name, 'Environment name');
  const description = requireText(body.description, 'Environment description');
  const code = normalizeConfigCode(body.code, name, 20);
  if (code.length < 2) { const error = new Error('Environment code must be at least 2 characters.'); error.status = 400; throw error; }
  const existing = await ServiceEnvironment.findOne({ organizationId, code });
  if (existing) { const error = new Error(`Environment code ${code} already exists.`); error.status = 409; throw error; }
  return ServiceEnvironment.create({
    organizationId,
    code,
    name,
    description,
    environmentType: body.environmentType || 'non_production',
    slaApplicableByDefault: body.slaApplicableByDefault === true || body.slaApplicableByDefault === 'on',
    displayOrder: Number(body.displayOrder) || 100
  });
}

async function createSlaPolicy(organizationId, body) {
  const name = requireText(body.name, 'SLA policy name');
  const description = requireText(body.description, 'SLA policy description');
  const key = makeKey(name);
  const existing = await SlaPolicy.findOne({ organizationId, key });
  if (existing) return existing;

  const environmentIds = Array.isArray(body.applicableEnvironmentIds)
    ? body.applicableEnvironmentIds.filter(isValidId)
    : body.applicableEnvironmentIds && isValidId(body.applicableEnvironmentIds)
      ? [body.applicableEnvironmentIds]
      : [];

  return SlaPolicy.create({
    organizationId,
    name,
    key,
    description,
    supportWindow: body.supportWindow || 'business_hours',
    clockStartTrigger: body.clockStartTrigger || 'severity_selected',
    applicability: {
      applyOnlyWhenSeveritySelected: body.applyOnlyWhenSeveritySelected !== 'off',
      applicableEnvironmentIds: environmentIds,
      applicableIssueLevelCodes: Array.isArray(body.applicableIssueLevelCodes)
        ? body.applicableIssueLevelCodes.map((code) => String(code || '').toUpperCase()).filter(Boolean)
        : ['L2', 'L3']
    },
    rules: []
  });
}

async function seedBaseConfig(organizationId) {
  for (const item of configPresets.severities) await createSeverity(organizationId, item);
  for (const item of configPresets.priorities) await createPriority(organizationId, item);
  for (const item of configPresets.environments) await createEnvironment(organizationId, item);
  for (const item of configPresets.regions) await createRegion(organizationId, item);
  for (const item of configPresets.products) {
    const product = await createProduct(organizationId, item);
    for (const moduleItem of item.modules || []) await createModule(organizationId, { ...moduleItem, productId: product._id });
  }
}

async function seedSlaPreset(organizationId, presetKey) {
  await seedBaseConfig(organizationId);
  const preset = slaPresets[presetKey];
  if (!preset) {
    const error = new Error('SLA preset not found.');
    error.status = 404;
    throw error;
  }

  const policy = await createSlaPolicy(organizationId, {
    name: preset.name,
    description: preset.description,
    supportWindow: preset.supportWindow,
    clockStartTrigger: preset.clockStartTrigger,
    applicableIssueLevelCodes: ['L2', 'L3']
  });

  const severities = await Severity.find({ organizationId });
  const severityByCode = new Map(severities.map((severity) => [severity.code, severity]));
  const existingRules = new Set((policy.rules || []).map((rule) => String(rule.severityId || rule.priorityId)));
  for (const rule of preset.rules) {
    const severity = severityByCode.get(rule.code);
    if (!severity || existingRules.has(String(severity._id))) continue;
    policy.rules.push({
      ruleBasis: 'severity',
      severityId: severity._id,
      priorityId: null,
      responseTimeValue: rule.responseTimeValue,
      responseTimeUnit: rule.responseTimeUnit,
      resolutionTimeValue: rule.resolutionTimeValue,
      resolutionTimeUnit: rule.resolutionTimeUnit,
      updateFrequencyValue: rule.updateFrequencyValue,
      updateFrequencyUnit: rule.updateFrequencyUnit,
      clockType: rule.clockType,
      notes: rule.notes
    });
  }
  await policy.save();
  return policy;
}

organizationRouter.get('/:organizationId/config', async (req, res, next) => {
  try {
    const organization = await requireOrganization(req.params.organizationId);
    const bundle = await getConfigBundle(organization._id);
    res.json(bundle);
  } catch (error) {
    next(error);
  }
});

organizationRouter.post('/:organizationId/config/seed', async (req, res, next) => {
  try {
    const organization = await requireOrganization(req.params.organizationId);
    await seedBaseConfig(organization._id);
    res.status(201).json(await getConfigBundle(organization._id));
  } catch (error) {
    next(error);
  }
});

organizationRouter.post('/:organizationId/severities', async (req, res, next) => {
  try {
    const organization = await requireOrganization(req.params.organizationId);
    const severity = await createSeverity(organization._id, req.body);
    res.status(201).json({ severity });
  } catch (error) {
    next(error);
  }
});

organizationRouter.post('/:organizationId/priorities', async (req, res, next) => {
  try {
    const organization = await requireOrganization(req.params.organizationId);
    const priority = await createPriority(organization._id, req.body);
    res.status(201).json({ priority });
  } catch (error) {
    next(error);
  }
});

organizationRouter.post('/:organizationId/products', async (req, res, next) => {
  try {
    const organization = await requireOrganization(req.params.organizationId);
    const product = await createProduct(organization._id, req.body);
    res.status(201).json({ product });
  } catch (error) {
    next(error);
  }
});

organizationRouter.post('/:organizationId/modules', async (req, res, next) => {
  try {
    const organization = await requireOrganization(req.params.organizationId);
    const module = await createModule(organization._id, req.body);
    res.status(201).json({ module });
  } catch (error) {
    next(error);
  }
});

organizationRouter.post('/:organizationId/modules/bulk', async (req, res, next) => {
  try {
    const organization = await requireOrganization(req.params.organizationId);
    const productId = String(req.body.productId || '');
    if (!isValidId(productId)) return res.status(400).json({ message: 'Valid product is required.' });
    const product = await Product.findOne({ _id: productId, organizationId: organization._id, status: 'active' });
    if (!product) return res.status(404).json({ message: 'Product not found.' });
    const names = String(req.body.names || '')
      .split(/[\n,]+/)
      .map((value) => value.trim())
      .filter(Boolean);
    if (!names.length) return res.status(400).json({ message: 'Enter at least one module name.' });
    const created = [];
    const skipped = [];
    for (const name of names) {
      const code = normalizeConfigCode('', name, 20);
      const existing = await Module.findOne({ organizationId: organization._id, productId: product._id, code });
      if (existing) { skipped.push(existing.name); continue; }
      const module = await Module.create({ organizationId: organization._id, productId: product._id, code, name, description: `${name} module.` });
      created.push(module);
    }
    res.status(201).json({ created, skipped, message: `${created.length} module${created.length === 1 ? '' : 's'} added${skipped.length ? `; ${skipped.length} already existed` : ''}.` });
  } catch (error) { next(error); }
});

organizationRouter.post('/:organizationId/regions', async (req, res, next) => {
  try {
    const organization = await requireOrganization(req.params.organizationId);
    const region = await createRegion(organization._id, req.body);
    res.status(201).json({ region });
  } catch (error) {
    next(error);
  }
});

organizationRouter.post('/:organizationId/subregions', async (req, res, next) => {
  try {
    const organization = await requireOrganization(req.params.organizationId);
    const subregion = await createSubregion(organization._id, req.body);
    res.status(201).json({ subregion });
  } catch (error) { next(error); }
});

organizationRouter.post('/:organizationId/environments', async (req, res, next) => {
  try {
    const organization = await requireOrganization(req.params.organizationId);
    const environment = await createEnvironment(organization._id, req.body);
    res.status(201).json({ environment });
  } catch (error) {
    next(error);
  }
});

organizationRouter.get('/:organizationId/slas', async (req, res, next) => {
  try {
    const organization = await requireOrganization(req.params.organizationId);
    const bundle = await getConfigBundle(organization._id);
    res.json({ slaPolicies: bundle.slaPolicies, severities: bundle.severities, priorities: bundle.priorities, environments: bundle.environments, clients: bundle.clients });
  } catch (error) {
    next(error);
  }
});


organizationRouter.post('/:organizationId/severities/:severityId', async (req, res, next) => {
  try {
    const organization = await requireOrganization(req.params.organizationId);
    const item = await Severity.findOne({ _id: req.params.severityId, organizationId: organization._id });
    if (!item) return res.status(404).json({ message: 'Severity not found.' });
    item.name = requireText(req.body.name, 'Severity name');
    item.description = requireText(req.body.description, 'Severity description');
    item.code = normalizeConfigCode(req.body.code, item.name, 12);
    if (await Severity.exists({ organizationId: organization._id, code: item.code, _id: { $ne: item._id } })) return res.status(409).json({ message: `Severity code ${item.code} already exists.` });
    item.marker = req.body.marker || '';
    item.displayOrder = Number(req.body.displayOrder) || item.displayOrder || 100;
    item.status = req.body.status === 'inactive' ? 'inactive' : 'active';
    await item.save();
    res.json({ severity: item });
  } catch (error) { next(error); }
});

organizationRouter.post('/:organizationId/priorities/:priorityId', async (req, res, next) => {
  try {
    const organization = await requireOrganization(req.params.organizationId);
    const item = await Priority.findOne({ _id: req.params.priorityId, organizationId: organization._id });
    if (!item) return res.status(404).json({ message: 'Priority not found.' });
    item.name = requireText(req.body.name, 'Priority name');
    item.description = requireText(req.body.description, 'Priority description');
    item.code = normalizeConfigCode(req.body.code, item.name, 12);
    if (await Priority.exists({ organizationId: organization._id, code: item.code, _id: { $ne: item._id } })) return res.status(409).json({ message: `Priority code ${item.code} already exists.` });
    item.marker = req.body.marker || '';
    item.displayOrder = Number(req.body.displayOrder) || item.displayOrder || 100;
    item.status = req.body.status === 'inactive' ? 'inactive' : 'active';
    await item.save();
    res.json({ priority: item });
  } catch (error) { next(error); }
});

organizationRouter.post('/:organizationId/products/:productId', async (req, res, next) => {
  try {
    const organization = await requireOrganization(req.params.organizationId);
    const item = await Product.findOne({ _id: req.params.productId, organizationId: organization._id });
    if (!item) return res.status(404).json({ message: 'Product not found.' });
    item.name = requireText(req.body.name, 'Product name');
    item.description = requireText(req.body.description, 'Product description');
    item.code = normalizeConfigCode(req.body.code, item.name, 20);
    if (item.code.length < 2) return res.status(400).json({ message: 'Product code must be at least 2 characters.' });
    if (await Product.exists({ organizationId: organization._id, code: item.code, _id: { $ne: item._id } })) return res.status(409).json({ message: `Product code ${item.code} already exists.` });
    item.status = req.body.status === 'inactive' ? 'inactive' : 'active';
    await item.save();
    res.json({ product: item });
  } catch (error) { next(error); }
});

organizationRouter.post('/:organizationId/modules/:moduleId', async (req, res, next) => {
  try {
    const organization = await requireOrganization(req.params.organizationId);
    const item = await Module.findOne({ _id: req.params.moduleId, organizationId: organization._id });
    if (!item) return res.status(404).json({ message: 'Module not found.' });
    item.name = requireText(req.body.name, 'Module name');
    item.description = requireText(req.body.description, 'Module description');
    item.code = normalizeConfigCode(req.body.code, item.name, 20);
    if (await Module.exists({ organizationId: organization._id, productId: item.productId, code: item.code, _id: { $ne: item._id } })) return res.status(409).json({ message: `Module code ${item.code} already exists for this product.` });
    item.status = req.body.status === 'inactive' ? 'inactive' : 'active';
    await item.save();
    res.json({ module: item });
  } catch (error) { next(error); }
});

organizationRouter.post('/:organizationId/regions/:regionId', async (req, res, next) => {
  try {
    const organization = await requireOrganization(req.params.organizationId);
    const item = await Region.findOne({ _id: req.params.regionId, organizationId: organization._id });
    if (!item) return res.status(404).json({ message: 'Region not found.' });
    item.name = requireText(req.body.name, 'Region name');
    item.description = requireText(req.body.description, 'Region description');
    item.timezone = requireText(req.body.timezone, 'Timezone');
    item.code = normalizeConfigCode(req.body.code, item.name, 20);
    if (await Region.exists({ organizationId: organization._id, code: item.code, _id: { $ne: item._id } })) return res.status(409).json({ message: `Region code ${item.code} already exists.` });
    item.status = req.body.status === 'inactive' ? 'inactive' : 'active';
    await item.save();
    res.json({ region: item });
  } catch (error) { next(error); }
});

organizationRouter.post('/:organizationId/subregions/:subregionId', async (req, res, next) => {
  try {
    const organization = await requireOrganization(req.params.organizationId);
    const item = await Subregion.findOne({ _id: req.params.subregionId, organizationId: organization._id });
    if (!item) return res.status(404).json({ message: 'Subregion not found.' });
    const regionId = String(req.body.regionId || item.regionId || '');
    if (!isValidId(regionId)) return res.status(400).json({ message: 'Valid region is required.' });
    const region = await Region.findOne({ _id: regionId, organizationId: organization._id, status: 'active' });
    if (!region) return res.status(404).json({ message: 'Region not found.' });
    item.regionId = region._id;
    item.name = requireText(req.body.name, 'Subregion name');
    item.code = normalizeConfigCode(req.body.code, item.name, 20);
    if (await Subregion.exists({ organizationId: organization._id, regionId: region._id, code: item.code, _id: { $ne: item._id } })) return res.status(409).json({ message: `Subregion code ${item.code} already exists in ${region.name}.` });
    item.description = String(req.body.description || '').trim();
    item.timezone = String(req.body.timezone || '').trim();
    item.status = req.body.status === 'inactive' ? 'inactive' : 'active';
    await item.save();
    res.json({ subregion: item });
  } catch (error) { next(error); }
});

organizationRouter.post('/:organizationId/environments/:environmentId', async (req, res, next) => {
  try {
    const organization = await requireOrganization(req.params.organizationId);
    const item = await ServiceEnvironment.findOne({ _id: req.params.environmentId, organizationId: organization._id });
    if (!item) return res.status(404).json({ message: 'Environment not found.' });
    item.name = requireText(req.body.name, 'Environment name');
    item.description = requireText(req.body.description, 'Environment description');
    item.code = normalizeConfigCode(req.body.code, item.name, 20);
    if (item.code.length < 2) return res.status(400).json({ message: 'Environment code must be at least 2 characters.' });
    if (await ServiceEnvironment.exists({ organizationId: organization._id, code: item.code, _id: { $ne: item._id } })) return res.status(409).json({ message: `Environment code ${item.code} already exists.` });
    item.environmentType = req.body.environmentType || item.environmentType;
    item.slaApplicableByDefault = req.body.slaApplicableByDefault === true || req.body.slaApplicableByDefault === 'on';
    item.displayOrder = Number(req.body.displayOrder) || item.displayOrder || 100;
    item.status = req.body.status === 'inactive' ? 'inactive' : 'active';
    await item.save();
    res.json({ environment: item });
  } catch (error) { next(error); }
});

organizationRouter.post('/:organizationId/slas', async (req, res, next) => {
  try {
    const organization = await requireOrganization(req.params.organizationId);
    const slaPolicy = await createSlaPolicy(organization._id, req.body);
    res.status(201).json({ slaPolicy });
  } catch (error) {
    next(error);
  }
});

organizationRouter.post('/:organizationId/slas/presets/:presetKey', async (req, res, next) => {
  try {
    const organization = await requireOrganization(req.params.organizationId);
    const slaPolicy = await seedSlaPreset(organization._id, req.params.presetKey);
    res.status(201).json({ slaPolicy });
  } catch (error) {
    next(error);
  }
});

organizationRouter.get('/:organizationId/slas/:slaPolicyId', async (req, res, next) => {
  try {
    const organization = await requireOrganization(req.params.organizationId);
    if (!isValidId(req.params.slaPolicyId)) return res.status(400).json({ message: 'Invalid SLA policy id.' });
    const policy = await SlaPolicy.findOne({ _id: req.params.slaPolicyId, organizationId: organization._id });
    if (!policy) return res.status(404).json({ message: 'SLA policy not found.' });
    const bundle = await getConfigBundle(organization._id);
    const severityMap = new Map(bundle.severities.map((item) => [String(item._id), item]));
    const priorityMap = new Map(bundle.priorities.map((item) => [String(item._id), item]));
    res.json({ slaPolicy: decorateSla(policy, severityMap, priorityMap), severities: bundle.severities, priorities: bundle.priorities, environments: bundle.environments, clients: bundle.clients });
  } catch (error) {
    next(error);
  }
});


organizationRouter.post('/:organizationId/slas/:slaPolicyId', async (req, res, next) => {
  try {
    const organization = await requireOrganization(req.params.organizationId);
    if (!isValidId(req.params.slaPolicyId)) return res.status(400).json({ message: 'Invalid SLA policy id.' });
    const policy = await SlaPolicy.findOne({ _id: req.params.slaPolicyId, organizationId: organization._id });
    if (!policy) return res.status(404).json({ message: 'SLA policy not found.' });
    policy.name = requireText(req.body.name, 'SLA policy name');
    policy.key = makeKey(policy.name);
    policy.description = requireText(req.body.description, 'SLA policy description');
    policy.supportWindow = req.body.supportWindow || policy.supportWindow;
    policy.clockStartTrigger = req.body.clockStartTrigger || policy.clockStartTrigger;
    policy.status = req.body.status === 'inactive' ? 'inactive' : 'active';
    policy.applicability.applyOnlyWhenSeveritySelected = req.body.applyOnlyWhenSeveritySelected !== 'off';
    policy.applicability.applicableIssueLevelCodes = Array.isArray(req.body.applicableIssueLevelCodes) ? req.body.applicableIssueLevelCodes.map((x) => String(x).toUpperCase()) : ['L2','L3'];
    await policy.save();
    res.json({ slaPolicy: policy });
  } catch (error) { next(error); }
});

organizationRouter.post('/:organizationId/slas/:slaPolicyId/rules', async (req, res, next) => {
  try {
    const organization = await requireOrganization(req.params.organizationId);
    if (!isValidId(req.params.slaPolicyId)) return res.status(400).json({ message: 'Invalid SLA policy id.' });
    const policy = await SlaPolicy.findOne({ _id: req.params.slaPolicyId, organizationId: organization._id });
    if (!policy) return res.status(404).json({ message: 'SLA policy not found.' });

    const ruleBasis = req.body.ruleBasis === 'priority' ? 'priority' : 'severity';
    const severityId = ruleBasis === 'severity' ? String(req.body.severityId || '') : '';
    const priorityId = ruleBasis === 'priority' ? String(req.body.priorityId || '') : '';

    if (ruleBasis === 'severity') {
      if (!isValidId(severityId)) return res.status(400).json({ message: 'Valid severity is required.' });
      const severity = await Severity.findOne({ _id: severityId, organizationId: organization._id });
      if (!severity) return res.status(404).json({ message: 'Severity not found.' });
      policy.rules = (policy.rules || []).filter((rule) => String(rule.severityId || '') !== String(severity._id));
    } else {
      if (!isValidId(priorityId)) return res.status(400).json({ message: 'Valid priority is required.' });
      const priority = await Priority.findOne({ _id: priorityId, organizationId: organization._id });
      if (!priority) return res.status(404).json({ message: 'Priority not found.' });
      policy.rules = (policy.rules || []).filter((rule) => String(rule.priorityId || '') !== String(priority._id));
    }

    policy.rules.push({
      ruleBasis,
      severityId: ruleBasis === 'severity' ? severityId : null,
      priorityId: ruleBasis === 'priority' ? priorityId : null,
      responseTimeValue: numberOrNull(req.body.responseTimeValue),
      responseTimeUnit: req.body.responseTimeUnit || 'hours',
      resolutionTimeValue: numberOrNull(req.body.resolutionTimeValue),
      resolutionTimeUnit: req.body.resolutionTimeUnit || 'hours',
      updateFrequencyValue: numberOrNull(req.body.updateFrequencyValue),
      updateFrequencyUnit: req.body.updateFrequencyUnit || 'daily',
      clockType: req.body.clockType || 'working_hours',
      notes: String(req.body.notes || '').trim()
    });

    await policy.save();
    res.status(201).json({ slaPolicy: policy });
  } catch (error) {
    next(error);
  }
});

function buildClientTree(clients) {
  const map = new Map();
  clients.forEach((client) => {
    const item = client.toObject ? client.toObject() : { ...client };
    item.children = [];
    map.set(String(item._id), item);
  });

  const roots = [];
  map.forEach((item) => {
    const parentId = item.parentClientId ? String(item.parentClientId) : '';
    const parent = parentId ? map.get(parentId) : null;
    if (parent) parent.children.push(item);
    else roots.push(item);
  });

  const sortNodes = (nodes) => {
    nodes.sort((a, b) => a.name.localeCompare(b.name));
    nodes.forEach((node) => sortNodes(node.children));
  };
  sortNodes(roots);
  return roots;
}

function flattenClientTree(nodes, output = [], trail = []) {
  nodes.forEach((node) => {
    const pathNames = [...trail, node.name];
    output.push({
      ...node,
      pathLabel: pathNames.join(' / '),
      childCount: node.children?.length || 0
    });
    flattenClientTree(node.children || [], output, pathNames);
  });
  return output;
}

async function loadClientSet(organizationId) {
  const clients = await Client.find({ organizationId }).sort({ depth: 1, name: 1, createdAt: 1 });
  const tree = buildClientTree(clients);
  return { clients: flattenClientTree(tree), tree };
}

async function validateParentClient(organizationId, parentClientId) {
  if (!parentClientId) return null;
  if (!isValidId(parentClientId)) {
    const error = new Error('Invalid parent client id.');
    error.status = 400;
    throw error;
  }
  const parent = await Client.findOne({ _id: parentClientId, organizationId });
  if (!parent) {
    const error = new Error('Parent client not found.');
    error.status = 404;
    throw error;
  }
  return parent;
}


function clientHasOwnProductModule(client) {
  return (client.enabledProductIds || []).length > 0 && (client.enabledModuleIds || []).length > 0;
}

function assertClientCanBeActive(client) {
  if (client.status !== 'active') return;
  if ((client.productModuleMode || 'custom') === 'custom' && !clientHasOwnProductModule(client)) {
    const error = new Error('Add at least one product and one module before activating this client.');
    error.status = 400;
    throw error;
  }
}


async function resolveEffectiveClientIssueFamilyIds(client, organizationId, seen = new Set()) {
  if (!client) return [];
  const clientId = String(client._id || '');
  if (seen.has(clientId)) return [];
  seen.add(clientId);
  if (client.issueTypeMode === 'inherit' && client.parentClientId) {
    const parent = await Client.findOne({ _id: client.parentClientId, organizationId });
    return resolveEffectiveClientIssueFamilyIds(parent, organizationId, seen);
  }
  return (client.enabledFamilyIds || []).map(String);
}

async function pruneOperationalRulesOutsideClientFamilies(client, organizationId) {
  const allowedFamilyIds = new Set(await resolveEffectiveClientIssueFamilyIds(client, organizationId));
  if (!allowedFamilyIds.size || !(client.operationalRules || []).length) {
    if (!allowedFamilyIds.size && (client.operationalRules || []).length) client.operationalRules = [];
    return;
  }
  const subtypeIds = [...new Set((client.operationalRules || []).map((rule) => String(rule.level2TypeId || '')).filter(Boolean))];
  const subtypes = await IssueType.find({ organizationId, level: 2, _id: { $in: subtypeIds } }).select('_id parentTypeId');
  const subtypeFamilyById = new Map(subtypes.map((item) => [String(item._id), String(item.parentTypeId || '')]));
  client.operationalRules = (client.operationalRules || []).filter((rule) => allowedFamilyIds.has(subtypeFamilyById.get(String(rule.level2TypeId || '')) || ''));
}

organizationRouter.get('/:organizationId/clients/code/suggest', async (req, res, next) => {
  try {
    const organization = await requireOrganization(req.params.organizationId);
    const result = await suggestClientCode(organization._id, {
      name: req.query.name,
      shortCode: req.query.shortCode,
      excludeClientId: req.query.excludeClientId
    });
    res.json(result);
  } catch (error) {
    next(error);
  }
});

organizationRouter.get('/:organizationId/clients', async (req, res, next) => {
  try {
    const organization = await requireOrganization(req.params.organizationId);
    const payload = await loadClientSet(organization._id);
    res.json(payload);
  } catch (error) {
    next(error);
  }
});

organizationRouter.post('/:organizationId/clients', async (req, res, next) => {
  try {
    const organization = await requireOrganization(req.params.organizationId);
    const name = req.body.name?.trim();
    if (!name) return res.status(400).json({ message: 'Client name is required.' });

    const parent = await validateParentClient(organization._id, req.body.parentClientId || null);
    const suggested = await suggestClientCode(organization._id, { name, shortCode: req.body.shortCode });
    const shortCode = normalizeClientShortCode(req.body.shortCode || suggested.shortCode);

    const existing = await Client.findOne({ organizationId: organization._id, shortCode });
    if (existing) return res.status(409).json({ message: `Client code ${shortCode} already exists.` });

    const regionId = isValidId(req.body.regionId) ? req.body.regionId : null;
    let region = null;
    if (regionId) {
      region = await Region.findOne({ _id: regionId, organizationId: organization._id, status: 'active' });
      if (!region) return res.status(404).json({ message: 'Region not found.' });
    }
    const subregionId = isValidId(req.body.subregionId) ? req.body.subregionId : null;
    let subregion = null;
    if (subregionId) {
      subregion = await Subregion.findOne({ _id: subregionId, organizationId: organization._id, status: 'active' });
      if (!subregion || !regionId || String(subregion.regionId) !== String(regionId)) return res.status(400).json({ message: 'Subregion does not belong to the selected region.' });
    }
    const timezone = req.body.timezone?.trim() || subregion?.timezone || region?.timezone || '';

    const client = await Client.create({
      organizationId: organization._id,
      parentClientId: parent?._id || null,
      name,
      shortCode,
      primaryDomain: req.body.primaryDomain?.trim().toLowerCase() || '',
      description: req.body.description?.trim() || '',
      notes: req.body.notes?.trim() || '',
      regionId,
      subregionId,
      timezone,
      businessCalendarMode: parent ? 'inherit' : 'custom',
      businessCalendar: {
        timezone: timezone || 'UTC',
        workingDays: [1, 2, 3, 4, 5],
        dayStart: '09:00',
        dayEnd: '17:00',
        holidays: []
      },
      status: req.body.status === 'inactive' ? 'inactive' : 'active',
      depth: parent ? parent.depth + 1 : 0,
      path: parent ? [...(parent.path || []), parent._id] : [],
      issueTypeMode: parent ? 'inherit' : 'custom',
      enabledFamilyIds: [],
      enabledLevel1IssueTypeIds: [],
      slaMode: parent ? 'inherit' : 'custom',
      defaultSlaPolicyId: null,
      productModuleMode: parent ? 'inherit' : 'custom',
      enabledProductIds: [],
      enabledModuleIds: [],
      enabledEnvironmentIds: []
    });

    res.status(201).json({ client });
  } catch (error) {
    next(error);
  }
});

organizationRouter.get('/:organizationId/clients/:clientId', async (req, res, next) => {
  try {
    const organization = await requireOrganization(req.params.organizationId);
    if (!isValidId(req.params.clientId)) return res.status(400).json({ message: 'Invalid client id.' });
    const client = await Client.findOne({ _id: req.params.clientId, organizationId: organization._id });
    if (!client) return res.status(404).json({ message: 'Client not found.' });
    res.json({ client });
  } catch (error) {
    next(error);
  }
});

organizationRouter.post('/:organizationId/clients/:clientId', async (req, res, next) => {
  try {
    const organization = await requireOrganization(req.params.organizationId);
    if (!isValidId(req.params.clientId)) return res.status(400).json({ message: 'Invalid client id.' });

    const client = await Client.findOne({ _id: req.params.clientId, organizationId: organization._id });
    if (!client) return res.status(404).json({ message: 'Client not found.' });

    const name = req.body.name?.trim();
    if (!name) return res.status(400).json({ message: 'Client name is required.' });
    const shortCode = normalizeClientShortCode(req.body.shortCode);

    const existing = await Client.findOne({ organizationId: organization._id, shortCode, _id: { $ne: client._id } });
    if (existing) return res.status(409).json({ message: `Client code ${shortCode} already exists.` });

    const regionId = isValidId(req.body.regionId) ? req.body.regionId : null;
    let region = null;
    if (regionId) {
      region = await Region.findOne({ _id: regionId, organizationId: organization._id, status: 'active' });
      if (!region) return res.status(404).json({ message: 'Region not found.' });
    }
    const subregionId = isValidId(req.body.subregionId) ? req.body.subregionId : null;
    let subregion = null;
    if (subregionId) {
      subregion = await Subregion.findOne({ _id: subregionId, organizationId: organization._id, status: 'active' });
      if (!subregion || !regionId || String(subregion.regionId) !== String(regionId)) return res.status(400).json({ message: 'Subregion does not belong to the selected region.' });
    }

    client.name = name;
    client.shortCode = shortCode;
    client.primaryDomain = req.body.primaryDomain?.trim().toLowerCase() || '';
    client.description = req.body.description?.trim() || '';
    client.notes = req.body.notes?.trim() || '';
    client.regionId = regionId;
    client.subregionId = subregionId;
    client.timezone = req.body.timezone?.trim() || subregion?.timezone || region?.timezone || '';
    client.status = req.body.status === 'active' ? 'active' : 'inactive';
    assertClientCanBeActive(client);
    await client.save();
    res.json({ client });
  } catch (error) {
    next(error);
  }
});

organizationRouter.delete('/:organizationId/clients/:clientId', async (req, res, next) => {
  try {
    const organization = await requireOrganization(req.params.organizationId);
    if (!isValidId(req.params.clientId)) return res.status(400).json({ message: 'Invalid client id.' });
    const client = await Client.findOne({ _id: req.params.clientId, organizationId: organization._id });
    if (!client) return res.status(404).json({ message: 'Client not found.' });
    const childCount = await Client.countDocuments({ organizationId: organization._id, parentClientId: client._id });
    if (childCount > 0) return res.status(409).json({ message: `Delete the ${childCount} child client${childCount === 1 ? '' : 's'} first, or deactivate this client instead.` });
    await Client.deleteOne({ _id: client._id, organizationId: organization._id });
    res.json({ deleted: true, clientId: String(client._id), name: client.name, shortCode: client.shortCode });
  } catch (error) {
    next(error);
  }
});

organizationRouter.post('/:organizationId/clients/:clientId/availability', async (req, res, next) => {
  try {
    const organization = await requireOrganization(req.params.organizationId);
    if (!isValidId(req.params.clientId)) return res.status(400).json({ message: 'Invalid client id.' });

    const client = await Client.findOne({ _id: req.params.clientId, organizationId: organization._id });
    if (!client) return res.status(404).json({ message: 'Client not found.' });

    const requestedMode = req.body.issueTypeMode === 'inherit' ? 'inherit' : 'custom';
    if (requestedMode === 'inherit') {
      if (!client.parentClientId) return res.status(400).json({ message: 'Root clients cannot inherit issue type availability.' });
      client.issueTypeMode = 'inherit';
      client.enabledFamilyIds = [];
      // A child that inherits family availability should inherit family-specific SLA choices as well.
      client.familySlaAssignments = [];
    } else {
      const requestedIds = [...new Set(Array.isArray(req.body.enabledFamilyIds) ? req.body.enabledFamilyIds : [])].map(String);
      const level1Types = await IssueType.find({ organizationId: organization._id, level: 1, status: 'active', _id: { $in: requestedIds } });
      const validIds = level1Types.map((type) => type._id);
      const validSet = new Set(validIds.map(String));
      client.issueTypeMode = 'custom';
      client.enabledFamilyIds = validIds;
      client.familySlaAssignments = (client.familySlaAssignments || []).filter((assignment) => validSet.has(String(assignment.level1TypeId || '')));
    }

    await pruneOperationalRulesOutsideClientFamilies(client, organization._id);
    assertClientCanBeActive(client);
    await client.save();
    res.json({ client });
  } catch (error) {
    next(error);
  }
});

organizationRouter.post('/:organizationId/clients/:clientId/sla', async (req, res, next) => {
  try {
    const organization = await requireOrganization(req.params.organizationId);
    if (!isValidId(req.params.clientId)) return res.status(400).json({ message: 'Invalid client id.' });
    const client = await Client.findOne({ _id: req.params.clientId, organizationId: organization._id });
    if (!client) return res.status(404).json({ message: 'Client not found.' });

    const requestedMode = req.body.slaMode === 'inherit' ? 'inherit' : 'custom';
    if (requestedMode === 'inherit') {
      if (!client.parentClientId) return res.status(400).json({ message: 'Root clients cannot inherit SLA policy.' });
      client.slaMode = 'inherit';
      client.defaultSlaPolicyId = null;
    } else {
      const slaPolicyId = String(req.body.slaPolicyId || '');
      client.slaMode = 'custom';
      if (!slaPolicyId) {
        client.defaultSlaPolicyId = null;
      } else {
        if (!isValidId(slaPolicyId)) return res.status(400).json({ message: 'Invalid SLA policy id.' });
        const policy = await SlaPolicy.findOne({ _id: slaPolicyId, organizationId: organization._id, status: 'active' });
        if (!policy) return res.status(404).json({ message: 'SLA policy not found.' });
        client.defaultSlaPolicyId = policy._id;
      }
    }

    await client.save();
    res.json({ client });
  } catch (error) {
    next(error);
  }
});


organizationRouter.post('/:organizationId/clients/:clientId/sla-family', async (req, res, next) => {
  try {
    const organization = await requireOrganization(req.params.organizationId);
    if (!isValidId(req.params.clientId)) return res.status(400).json({ message: 'Invalid client id.' });
    const client = await Client.findOne({ _id: req.params.clientId, organizationId: organization._id });
    if (!client) return res.status(404).json({ message: 'Client not found.' });

    const level1TypeId = String(req.body.level1TypeId || '');
    const slaPolicyId = String(req.body.slaPolicyId || '');
    if (!isValidId(level1TypeId)) return res.status(400).json({ message: 'Valid Issue Family id is required.' });
    const family = await IssueType.findOne({ _id: level1TypeId, organizationId: organization._id, level: 1, status: 'active' });
    if (!family) return res.status(404).json({ message: 'Issue Family not found.' });

    const enabled = new Set((client.enabledFamilyIds || []).map(String));
    if (client.issueTypeMode === 'custom' && !enabled.has(String(family._id))) {
      return res.status(400).json({ message: 'That Issue Family is not enabled for this client.' });
    }

    const assignments = (client.familySlaAssignments || []).map((item) => item.toObject ? item.toObject() : item);
    const localId = `family_${String(family._id)}`.slice(0, 80);
    const existingIndex = assignments.findIndex((item) => String(item.level1TypeId || '') === String(family._id));

    if (!slaPolicyId) {
      if (existingIndex >= 0) assignments.splice(existingIndex, 1);
    } else {
      if (!isValidId(slaPolicyId)) return res.status(400).json({ message: 'Invalid SLA policy id.' });
      const policy = await SlaPolicy.findOne({ _id: slaPolicyId, organizationId: organization._id, status: 'active' });
      if (!policy) return res.status(404).json({ message: 'SLA policy not found.' });
      const next = { localId, level1TypeId: family._id, slaPolicyId: policy._id, inheritToChildren: req.body.inheritToChildren !== false && req.body.inheritToChildren !== 'false', isActive: true };
      if (existingIndex >= 0) assignments[existingIndex] = next;
      else assignments.push(next);
    }

    client.familySlaAssignments = assignments;
    await client.save();
    res.json({ client });
  } catch (error) {
    next(error);
  }
});


organizationRouter.post('/:organizationId/clients/:clientId/context', async (req, res, next) => {
  try {
    const organization = await requireOrganization(req.params.organizationId);
    if (!isValidId(req.params.clientId)) return res.status(400).json({ message: 'Invalid client id.' });
    const client = await Client.findOne({ _id: req.params.clientId, organizationId: organization._id });
    if (!client) return res.status(404).json({ message: 'Client not found.' });

    const regionId = isValidId(req.body.regionId) ? req.body.regionId : null;
    if (regionId) {
      const region = await Region.findOne({ _id: regionId, organizationId: organization._id, status: 'active' });
      if (!region) return res.status(404).json({ message: 'Region not found.' });
      client.regionId = region._id;
      client.timezone = region.timezone || client.timezone || '';
    } else {
      client.regionId = null;
    }
    const subregionId = isValidId(req.body.subregionId) ? req.body.subregionId : null;
    if (subregionId) {
      const subregion = await Subregion.findOne({ _id: subregionId, organizationId: organization._id, status: 'active' });
      if (!subregion || !client.regionId || String(subregion.regionId) !== String(client.regionId)) return res.status(400).json({ message: 'Subregion does not belong to the selected region.' });
      client.subregionId = subregion._id;
      if (subregion.timezone) client.timezone = subregion.timezone;
    } else {
      client.subregionId = null;
    }
    if (typeof req.body.timezone === 'string' && req.body.timezone.trim()) client.timezone = req.body.timezone.trim();

    const requestedCalendarMode = req.body.businessCalendarMode === 'inherit' ? 'inherit' : 'custom';
    if (requestedCalendarMode === 'inherit') {
      if (!client.parentClientId) return res.status(400).json({ message: 'Root clients cannot inherit a business calendar.' });
      client.businessCalendarMode = 'inherit';
    } else {
      const workingDays = [...new Set((Array.isArray(req.body.businessCalendar?.workingDays) ? req.body.businessCalendar.workingDays : req.body.workingDays || [])
        .map(Number)
        .filter((day) => Number.isInteger(day) && day >= 1 && day <= 7))].sort((a, b) => a - b);
      const clockPattern = /^([01]\d|2[0-3]):[0-5]\d$/;
      const dayStart = String(req.body.businessCalendar?.dayStart || req.body.dayStart || '09:00').trim();
      const dayEnd = String(req.body.businessCalendar?.dayEnd || req.body.dayEnd || '17:00').trim();
      if (!clockPattern.test(dayStart) || !clockPattern.test(dayEnd) || dayStart >= dayEnd) {
        return res.status(400).json({ message: 'Business calendar working hours must use valid HH:MM values with start before end.' });
      }
      const requestedHolidays = Array.isArray(req.body.businessCalendar?.holidays)
        ? req.body.businessCalendar.holidays
        : Array.isArray(req.body.holidays) ? req.body.holidays : [];
      const holidays = requestedHolidays
        .map((item) => typeof item === 'string' ? { date: item.trim(), name: '' } : { date: String(item?.date || '').trim(), name: String(item?.name || '').trim().slice(0, 120) })
        .filter((item) => /^\d{4}-\d{2}-\d{2}$/.test(item.date));
      client.businessCalendarMode = 'custom';
      client.businessCalendar = {
        timezone: String(req.body.businessCalendar?.timezone || client.timezone || '').trim(),
        workingDays: workingDays.length ? workingDays : [1, 2, 3, 4, 5],
        dayStart,
        dayEnd,
        holidays: [...new Map(holidays.map((item) => [item.date, item])).values()]
      };
    }

    const requestedEnvironmentIds = [...new Set(Array.isArray(req.body.enabledEnvironmentIds) ? req.body.enabledEnvironmentIds : [])]
      .map(String)
      .filter(isValidId);
    const environments = await ServiceEnvironment.find({ organizationId: organization._id, status: 'active', _id: { $in: requestedEnvironmentIds } });
    client.enabledEnvironmentIds = environments.map((environment) => environment._id);

    assertClientCanBeActive(client);
    await client.save();
    res.json({ client });
  } catch (error) {
    next(error);
  }
});

organizationRouter.post('/:organizationId/clients/:clientId/products', async (req, res, next) => {
  try {
    const organization = await requireOrganization(req.params.organizationId);
    if (!isValidId(req.params.clientId)) return res.status(400).json({ message: 'Invalid client id.' });
    const client = await Client.findOne({ _id: req.params.clientId, organizationId: organization._id });
    if (!client) return res.status(404).json({ message: 'Client not found.' });

    const requestedMode = req.body.productModuleMode === 'inherit' ? 'inherit' : 'custom';
    if (requestedMode === 'inherit') {
      if (!client.parentClientId) return res.status(400).json({ message: 'Root clients cannot inherit product and module availability.' });
      client.productModuleMode = 'inherit';
      client.enabledProductIds = [];
      client.enabledModuleIds = [];
    } else {
      const requestedProductIds = [...new Set(Array.isArray(req.body.enabledProductIds) ? req.body.enabledProductIds : [])]
        .map(String)
        .filter(isValidId);
      const products = await Product.find({ organizationId: organization._id, status: 'active', _id: { $in: requestedProductIds } });
      const validProductIds = products.map((product) => product._id);
      const validProductIdSet = new Set(validProductIds.map(String));

      const requestedModuleIds = [...new Set(Array.isArray(req.body.enabledModuleIds) ? req.body.enabledModuleIds : [])]
        .map(String)
        .filter(isValidId);
      const modules = await Module.find({ organizationId: organization._id, status: 'active', _id: { $in: requestedModuleIds } });
      const validModuleIds = modules
        .filter((module) => validProductIdSet.has(String(module.productId)))
        .map((module) => module._id);

      client.productModuleMode = 'custom';
      client.enabledProductIds = validProductIds;
      client.enabledModuleIds = validModuleIds;
    }

    assertClientCanBeActive(client);
    await client.save();
    res.json({ client });
  } catch (error) {
    next(error);
  }
});



// Basic admin audit / activity log
organizationRouter.get('/:organizationId/audit', async (req, res, next) => {
  try {
    const organization = await requireOrganization(req.params.organizationId);
    const limit = Math.min(500, Math.max(25, Number(req.query.limit || 200)));
    const logs = await AuditLog.find({ organizationId: organization._id }).sort({ createdAt: -1 }).limit(limit).lean();
    res.json({ logs });
  } catch (error) { next(error); }
});

organizationRouter.post('/:organizationId/audit', async (req, res, next) => {
  try {
    const organization = await requireOrganization(req.params.organizationId);
    const log = await AuditLog.create({
      organizationId: organization._id,
      eventType: String(req.body.eventType || 'activity').trim().slice(0, 80),
      message: String(req.body.message || 'Activity recorded.').trim().slice(0, 1000),
      targetType: String(req.body.targetType || '').trim().slice(0, 80),
      targetId: String(req.body.targetId || '').trim().slice(0, 120),
      targetLabel: String(req.body.targetLabel || '').trim().slice(0, 180),
      actor: req.body.actor || {},
      metadata: req.body.metadata || {}
    });
    res.status(201).json({ log });
  } catch (error) { next(error); }
});

// Saved Sun Query Language filters
organizationRouter.get('/:organizationId/filters', async (req, res, next) => {
  try {
    const organization = await requireOrganization(req.params.organizationId);
    const target = ['requests', 'clients'].includes(String(req.query.target || '')) ? String(req.query.target) : null;
    const filter = { organizationId: organization._id, status: 'active' };
    if (target) filter.target = target;
    const filters = await SavedFilter.find(filter).sort({ target: 1, name: 1, createdAt: -1 }).lean();
    res.json({ filters });
  } catch (error) {
    next(error);
  }
});

organizationRouter.post('/:organizationId/filters', async (req, res, next) => {
  try {
    const organization = await requireOrganization(req.params.organizationId);
    const name = requireText(req.body.name, 'Filter name');
    const target = ['requests', 'clients'].includes(String(req.body.target || '')) ? String(req.body.target) : 'requests';
    const query = String(req.body.query || '').trim().slice(0, 1000);
    const createdBy = String(req.body.createdBy || '').trim().slice(0, 180);
    const createdByRole = String(req.body.createdByRole || '').trim().slice(0, 80);
    const visibilityScope = ['private', 'team', 'tenant'].includes(String(req.body.visibilityScope || '')) ? String(req.body.visibilityScope) : 'private';
    const filter = await SavedFilter.findOneAndUpdate(
      { organizationId: organization._id, name, target },
      { $set: { query, createdBy, createdByRole, visibilityScope, status: 'active' } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    res.json({ filter });
  } catch (error) {
    next(error);
  }
});


organizationRouter.post('/:organizationId/filters/:filterId/visibility', async (req, res, next) => {
  try {
    const organization = await requireOrganization(req.params.organizationId);
    if (!isValidId(req.params.filterId)) return res.status(400).json({ message: 'Invalid filter id.' });
    const visibilityScope = ['private', 'team', 'tenant'].includes(String(req.body.visibilityScope || '')) ? String(req.body.visibilityScope) : 'private';
    const filter = await SavedFilter.findOneAndUpdate(
      { _id: req.params.filterId, organizationId: organization._id, status: 'active' },
      { $set: { visibilityScope } },
      { new: true }
    );
    if (!filter) return res.status(404).json({ message: 'Filter not found.' });
    res.json({ filter });
  } catch (error) {
    next(error);
  }
});

organizationRouter.post('/:organizationId/filters/:filterId/delete', async (req, res, next) => {
  try {
    const organization = await requireOrganization(req.params.organizationId);
    if (!isValidId(req.params.filterId)) return res.status(400).json({ message: 'Invalid filter id.' });
    await SavedFilter.findOneAndUpdate(
      { _id: req.params.filterId, organizationId: organization._id },
      { $set: { status: 'inactive' } }
    );
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});
