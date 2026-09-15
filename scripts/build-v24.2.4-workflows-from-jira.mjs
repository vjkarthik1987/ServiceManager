#!/usr/bin/env node
/**
 * Service Manager v24.2.4 — rebuild the four in-scope workflows from live Jira exports.
 *
 * The Jira *.full.json snapshots under config/v24-saas/jira-source are the source of truth.
 * This script deliberately does NOT rebuild Service Request workflows yet.
 *
 * It preserves the complete Jira transition metadata (conditions, validators, post-functions,
 * screens and portal properties) while exploding Jira multi-source transitions into one edge per
 * source status because Service Manager stores transitions as from -> to edges.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const CONFIG_DIR = path.join(ROOT, 'config', 'v24-saas');
const SOURCE_DIR = path.join(CONFIG_DIR, 'jira-source');
const WORKFLOWS_FILE = path.join(CONFIG_DIR, 'workflows.json');
const SUPPORT_PATHS_FILE = path.join(CONFIG_DIR, 'support-paths.json');
const SERVICE_MODEL_FILE = path.join(CONFIG_DIR, 'service-model.json');

const VERSION = '24.2.4';

const SOURCE_BY_FAMILY = {
  INCIDENT: 'incident.full.json',
  CHANGE: 'change.full.json',
  PROBLEM: 'problem.full.json',
  MAINTENANCE: 'maintenance.full.json'
};

const WORKFLOW_KEY_BY_FAMILY = {
  INCIDENT: 'WF_SAAS_INCIDENT',
  CHANGE: 'WF_SAAS_CHANGE',
  PROBLEM: 'WF_SAAS_PROBLEM',
  MAINTENANCE: 'WF_SAAS_MAINTENANCE'
};

const LOCAL_FIELD_KEY_BY_JIRA_NAME = {
  'Comment': 'COMMENT',
  'Assignee': 'ASSIGNEE',
  'Resolution': 'RESOLUTION',
  'Root Cause': 'ROOT_CAUSE',
  'RCA Category': 'RCA_CATEGORY',
  'Corrective Action': 'CORRECTIVE_ACTION',
  'Preventive Action': 'PREVENTIVE_ACTION',
  'Release ID old': 'RELEASE_ID',
  'S3 Bucket URL': 'S3_BUCKET_URL',
  'Test Case Link': 'TEST_CASE_LINK',
  'Requirement Document Link': 'REQUIREMENT_DOCUMENT_LINK',
  'Technical Design Document Link': 'TECHNICAL_DESIGN_DOCUMENT_LINK',
  'Functional Design Document Link': 'FUNCTIONAL_DESIGN_DOCUMENT_LINK',
  'Internal Linkage': 'INTERNAL_LINKAGE',
  'Component': 'COMPONENTS',
  'Approved Cost': 'APPROVED_COST',
  'Approved Effort': 'APPROVED_EFFORT',
  'Planned Release Date': 'PLANNED_RELEASE_DATE',
  'Actual Release Date': 'ACTUAL_RELEASE_DATE',
  'Production Movement Date': 'PRODUCTION_MOVEMENT_DATE',
  'RTO (in mins)': 'DR_RTO_MINUTES',
  'Start Time': 'MAINTENANCE_START_TIME',
  'End Time': 'MAINTENANCE_END_TIME',
  'Service Requests': 'SERVICE_REQUEST_LEVEL',
  'Service Requests Subtype': 'SERVICE_REQUEST_SUBTYPE',
  'Service Request Summary': 'SUMMARY',
  'Service Request Description': 'DESCRIPTION',
  'Service Request Application Username': 'APPLICATION_USERNAME',
  ' Service Request Department': 'DEPARTMENT',
  'Raised Environments': 'RAISED_ENVIRONMENT',
  'Privilege': 'PRIVILEGES',
  'Reasons': 'REASON',
  'Department Approvals': 'DEPARTMENT_APPROVAL',
  'Service Request Severity': 'SEVERITY'
};

const SUPPORT_VALUE_TO_LEVEL = {
  BANK: 'L1',
  PARTNER: 'L2',
  SUNTEC: 'L3',
  L1: 'L1',
  L2: 'L2',
  L3: 'L3'
};

const load = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const save = (file, value) => fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
const norm = (value) => String(value ?? '').trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
const text = (value) => String(value ?? '').trim();
const unique = (values) => [...new Set(values.filter(Boolean))];

function parseJsonMaybe(value) {
  if (!value || typeof value !== 'string') return null;
  try { return JSON.parse(value); } catch { return null; }
}

function sourceFieldsMap(source) {
  return new Map((source.references?.fields || []).map((field) => [String(field.id), field]));
}

function sourceScreensMap(source) {
  return source.references?.screens || {};
}

function localFieldDescriptor(jiraId, sourceField = {}) {
  const jiraName = text(sourceField.name || jiraId);
  const key = LOCAL_FIELD_KEY_BY_JIRA_NAME[jiraName] || norm(jiraName) || norm(jiraId);
  const schema = sourceField.schema || {};
  const jiraType = text(schema.type || 'string');
  const fieldType = jiraType === 'date' ? 'date'
    : jiraType === 'datetime' ? 'datetime'
      : jiraType === 'number' ? 'number'
        : jiraType === 'user' ? 'user'
          : jiraType === 'array' ? 'array'
            : jiraType === 'option' ? 'select'
              : jiraType === 'comments-page' ? 'comment'
                : jiraType === 'resolution' ? 'resolution'
                  : 'text';
  return { jiraId: String(jiraId), key, label: jiraName, fieldType, jiraSchema: schema };
}

function requiredFieldsForTransition(transition, fieldsById) {
  const ids = [];
  for (const validator of transition.validators || []) {
    const params = validator.parameters || {};
    if (validator.ruleKey === 'system:validate-field-value' && params.ruleType === 'fieldRequired') {
      ids.push(...String(params.fieldsRequired || '').split(',').map((v) => v.trim()).filter(Boolean));
    }
    if (/CommentRequiredValidator/i.test(String(params.appKey || '')) || /comment.*required/i.test(String(params.config || ''))) {
      ids.push('comment');
    }
  }
  return unique(ids).map((jiraId) => localFieldDescriptor(jiraId, fieldsById.get(String(jiraId)) || { id: jiraId, name: jiraId }));
}

function screenFieldsForTransition(transition, screensById, fieldsById) {
  const screenId = String(transition.transitionScreenId || transition.transitionScreen?.parameters?.screenId || '').trim();
  if (!screenId) return [];
  const screen = screensById[screenId];
  const fields = (screen?.tabs || []).flatMap((tab) => tab.fields || []);
  return fields.map((field) => localFieldDescriptor(field.id, fieldsById.get(String(field.id)) || field));
}

function allConditionEntries(conditions) {
  if (!conditions) return [];
  return [
    ...(conditions.conditions || []),
    ...(conditions.conditionGroups || []).flatMap((group) => allConditionEntries(group))
  ];
}

function quotedValues(expression, operator = '==') {
  const values = [];
  const escaped = operator === '!=' ? '!=' : '==';
  const rx = new RegExp(`${escaped}\\s*\\(?(?:\\\"|\")([^\"]+)(?:\\\"|\")\\)?`, 'g');
  let match;
  while ((match = rx.exec(expression))) values.push(match[1]);
  return values;
}

function normalizeJiraCondition(transition, statusKeyByJiraId) {
  const out = {};
  const raw = transition.conditions || null;
  for (const entry of allConditionEntries(raw)) {
    const params = entry.parameters || {};
    if (entry.ruleKey === 'system:previous-status-condition') {
      const ids = String(params.previousStatusIds || '').split(',').map((v) => v.trim()).filter(Boolean);
      out.previousStatusIds = unique([...(out.previousStatusIds || []), ...ids.map((id) => statusKeyByJiraId.get(id) || id)]);
      out.previousStatusMostRecentOnly = String(params.mostRecentStatusOnly || 'false') === 'true';
    }
    if (entry.ruleKey === 'system:restrict-issue-transition' && String(params.accountIds || '').includes('allow-reporter')) {
      out.reporterOnly = true;
    }
    if (entry.ruleKey === 'system:block-in-progress-approval') out.approvalGate = true;

    const parsed = parseJsonMaybe(params.config);
    const expression = text(parsed?.expression || parsed?.script || '');
    if (!expression) continue;

    const requestTypeMatches = [...expression.matchAll(/requestType\.name\s*==\s*"([^"]+)"/g)].map((m) => m[1]);
    const requestTypeExcludes = [...expression.matchAll(/requestType\.name\s*!=\s*"([^"]+)"/g)].map((m) => m[1]);
    if (requestTypeMatches.length) out.requestTypes = unique([...(out.requestTypes || []), ...requestTypeMatches]);
    if (requestTypeExcludes.length) out.excludedRequestTypes = unique([...(out.excludedRequestTypes || []), ...requestTypeExcludes]);

    const originEq = [...expression.matchAll(/customfield_10062\.value\s*==\s*\(?"([^"]+)"\)?/g)].map((m) => SUPPORT_VALUE_TO_LEVEL[norm(m[1])]).filter(Boolean);
    const originNe = [...expression.matchAll(/customfield_10062\.value\s*!=\s*\(?"([^"]+)"\)?/g)].map((m) => SUPPORT_VALUE_TO_LEVEL[norm(m[1])]).filter(Boolean);
    if (originEq.length) out.originSupportLevels = unique([...(out.originSupportLevels || []), ...originEq]);
    if (originNe.length) out.excludedOriginSupportLevels = unique([...(out.excludedOriginSupportLevels || []), ...originNe]);

    const currentEq = [...expression.matchAll(/customfield_10095\.value\s*==\s*\(?"([^"]+)"\)?/g)].map((m) => SUPPORT_VALUE_TO_LEVEL[norm(m[1])]).filter(Boolean);
    if (currentEq.length) out.currentSupportLevels = unique([...(out.currentSupportLevels || []), ...currentEq]);
  }
  if (raw) out.jiraCondition = raw;
  return out;
}

function jiraCustomerEnabled(transition) {
  return String(transition.properties?.['servicedesk.customer.transition.active'] || '').toLowerCase() === 'true';
}

function transitionKind(transition) {
  const conditions = allConditionEntries(transition.conditions);
  if (conditions.some((entry) => entry.ruleKey === 'system:block-in-progress-approval')) return 'approval';
  return 'status';
}

function inferStatusType(family, status, existing) {
  if (existing?.statusType) return existing.statusType;
  const name = norm(status.baseStatus?.name || status.fullStatus?.name || '');
  if (name === 'NEW' || name === 'OPEN') return 'start';
  if (name === 'CLOSED' || name === 'DUPLICATE' || name === 'NOT_AN_ISSUE' || name === 'NOT_A_CHANGE') return 'final';
  if (name === 'CANCELED' || name === 'CANCELLED') return 'cancelled';
  if (name.includes('ON_HOLD') || name === 'PENDING') return 'hold';
  if (name === 'RESOLVED' || name === 'COMPLETED' || name === 'VERIFY_AND_RESOLVE') return 'resolved';
  return 'normal';
}

function statusKeyResolver(source, existingWorkflow) {
  const byJiraId = new Map();
  const byName = new Map();
  for (const status of existingWorkflow.statuses || []) {
    if (status.jiraStatusId) byJiraId.set(String(status.jiraStatusId), status.key);
    byName.set(norm(status.name), status.key);
  }
  for (const status of source.statuses || []) {
    const jiraId = String(status.baseStatus?.id || status.fullStatus?.id || status.workflowStatus?.statusReference || '');
    const name = text(status.baseStatus?.name || status.fullStatus?.name || jiraId);
    if (!byJiraId.has(jiraId)) byJiraId.set(jiraId, byName.get(norm(name)) || norm(name));
  }
  return byJiraId;
}

function oldTransitionLookup(existingWorkflow) {
  const map = new Map();
  for (const transition of existingWorkflow.transitions || []) {
    map.set(`${String(transition.jiraTransitionId || '')}|${transition.from}|${transition.to}|${transition.label}`, transition);
  }
  return map;
}

function rebuildWorkflow(family, source, existingWorkflow, sourceFilename) {
  const statusKeyByJiraId = statusKeyResolver(source, existingWorkflow);
  const existingStatusByKey = new Map((existingWorkflow.statuses || []).map((s) => [s.key, s]));
  const fieldsById = sourceFieldsMap(source);
  const screensById = sourceScreensMap(source);
  const oldTransitions = oldTransitionLookup(existingWorkflow);

  const statuses = (source.statuses || []).map((status, index) => {
    const jiraId = String(status.baseStatus?.id || status.fullStatus?.id || status.workflowStatus?.statusReference || '');
    const key = statusKeyByJiraId.get(jiraId) || norm(status.baseStatus?.name || jiraId);
    const old = existingStatusByKey.get(key) || {};
    const name = text(status.baseStatus?.name || status.fullStatus?.name || old.name || key);
    return {
      key,
      name,
      category: old.category || (status.baseStatus?.statusCategory === 'DONE' ? 'resolved' : status.baseStatus?.statusCategory === 'TODO' ? 'start' : 'active'),
      jiraStatusId: jiraId,
      jiraStatusCategory: text(status.baseStatus?.statusCategory || ''),
      statusType: inferStatusType(family, status, old),
      customerLabel: old.customerLabel || name,
      isCustomerVisible: old.isCustomerVisible !== false,
      displayOrder: old.displayOrder || (index + 1) * 10,
      approvalConfiguration: status.workflowStatus?.approvalConfiguration || null,
      sourceProperties: status.workflowStatus?.properties || {},
      jiraDescription: text(status.baseStatus?.description || status.fullStatus?.description || '')
    };
  });

  const initial = (source.transitions || []).find((t) => t.type === 'INITIAL');
  const startStatus = statusKeyByJiraId.get(String(initial?.to?.id || initial?.raw?.toStatusReference || '')) || statuses[0]?.key || existingWorkflow.startStatus;

  const transitions = [];
  const globalActions = [];

  for (const transition of source.transitions || []) {
    if (transition.type === 'INITIAL') continue;
    const requiredFields = requiredFieldsForTransition(transition, fieldsById);
    const screenFields = screenFieldsForTransition(transition, screensById, fieldsById);
    const clientEnabled = jiraCustomerEnabled(transition);
    const normalizedCondition = normalizeJiraCondition(transition, statusKeyByJiraId);
    const rules = {
      conditions: transition.conditions || null,
      validators: transition.validators || [],
      actions: transition.actions || [],
      triggers: transition.triggers || [],
      properties: transition.properties || {},
      transitionScreenId: transition.transitionScreenId || null,
      screenFields
    };

    if (transition.type === 'GLOBAL') {
      globalActions.push({
        key: `JIRA_${transition.id}_${norm(transition.name)}`,
        label: text(transition.name),
        kind: 'escalation',
        statusEffect: 'KEEP',
        customerEnabled: clientEnabled,
        clientEnabled,
        jiraCustomerEnabled: clientEnabled,
        roles: clientEnabled ? ['client', 'partner', 'agent', 'manager', 'admin'] : ['partner', 'agent', 'manager', 'admin'],
        jiraTransitionId: String(transition.id),
        condition: normalizedCondition,
        requiredFields,
        jiraRules: rules
      });
      continue;
    }

    const toJiraId = String(transition.to?.id || transition.raw?.toStatusReference || '');
    const to = statusKeyByJiraId.get(toJiraId);
    if (!to) throw new Error(`${family}: unknown Jira target status ${toJiraId} for transition ${transition.id}`);

    for (const fromRef of transition.from || []) {
      if (typeof fromRef === 'string') continue;
      const fromJiraId = String(fromRef.id || '');
      const from = statusKeyByJiraId.get(fromJiraId);
      if (!from) throw new Error(`${family}: unknown Jira source status ${fromJiraId} for transition ${transition.id}`);
      const lookupKey = `${String(transition.id)}|${from}|${to}|${text(transition.name)}`;
      const old = oldTransitions.get(lookupKey) || {};
      const item = {
        key: old.key || `JIRA_${transition.id}_${from}`,
        from,
        to,
        label: text(transition.name),
        kind: transitionKind(transition),
        jiraTransitionId: String(transition.id),
        jiraTransitionType: transition.type,
        jiraCustomerEnabled: clientEnabled,
        clientEnabled,
        customerEnabled: clientEnabled,
        roles: clientEnabled ? ['client', 'partner', 'agent', 'manager', 'admin'] : ['partner', 'agent', 'manager', 'admin'],
        allowedSupportLevels: [],
        condition: normalizedCondition,
        requiredFields,
        transitionScreenId: transition.transitionScreenId || null,
        screenFields,
        jiraRules: rules
      };

      if (family === 'INCIDENT') {
        // These are the only workflow actions that genuinely move work between support levels.
        if (String(transition.id) === '101') {
          item.allowedSupportLevels = ['L1'];
          item.supportEffect = { targetLevel: 'L2' };
          item.targetSupportLevel = 'L2';
        } else if (String(transition.id) === '171') {
          item.allowedSupportLevels = ['L2'];
          item.supportEffect = { targetLevel: 'L3' };
          item.targetSupportLevel = 'L3';
        } else if (String(transition.id) === '441') {
          item.allowedSupportLevels = ['L2'];
        } else if (String(transition.id) === '451') {
          item.allowedSupportLevels = ['L3'];
        } else if (from === 'L2_SUPPORT' || from === 'L2_ANALYSIS' || from === 'L2_TEST_FAILED') {
          // Do not restrict transitions that intentionally leave L2 via supportEffect above.
          item.allowedSupportLevels = ['L2'];
        } else if (from === 'L3_SUPPORT' || from === 'L3_ANALYSIS' || from === 'VENDOR_TICKET_RAISED') {
          item.allowedSupportLevels = ['L3'];
        }
      }

      transitions.push(item);
    }
  }

  return {
    ...existingWorkflow,
    key: WORKFLOW_KEY_BY_FAMILY[family],
    serviceModelKey: 'SUNTEC_SAAS_V24',
    name: `SaaS ${family === 'CHANGE' ? 'Change Request' : family === 'MAINTENANCE' ? 'Maintenance Request' : family[0] + family.slice(1).toLowerCase()} v${VERSION} — live Jira API source`,
    description: `Rebuilt from ${source.identity?.name || sourceFilename}; exact Jira statuses and transition edges with source rules preserved.`,
    startStatus,
    supportStatusMode: family === 'INCIDENT' ? 'SHARED' : existingWorkflow.supportStatusMode,
    supportMovePolicy: family === 'INCIDENT' ? 'PRESERVE_OR_EXPLICIT_TARGET' : existingWorkflow.supportMovePolicy,
    newIsCreationOnly: family === 'INCIDENT' ? true : existingWorkflow.newIsCreationOnly,
    jiraSource: {
      file: sourceFilename,
      workflowId: source.identity?.id || '',
      workflowName: source.identity?.name || '',
      versionNumber: source.identity?.version?.versionNumber ?? null,
      versionId: source.identity?.version?.id || '',
      exportedAt: source.exportMetadata?.exportedAt || '',
      sha256: source.exportMetadata?.workflowSha256 || '',
      sourceEndpoint: source.exportMetadata?.sourceEndpoint || '',
      sourceStatusCount: source.statistics?.statusCount ?? statuses.length,
      sourceTransitionObjectCount: source.statistics?.transitionCount ?? source.transitions?.length ?? 0,
      directedEdgeCount: transitions.length,
      globalActionCount: globalActions.length
    },
    statuses,
    transitions,
    globalActions
  };
}

function rebuildIncidentSupportPath(supportPathsDoc, incidentWorkflow) {
  const idx = (supportPathsDoc.supportPaths || []).findIndex((p) => p.key === 'PATH_INCIDENT_COMMON_V24');
  if (idx < 0) throw new Error('PATH_INCIDENT_COMMON_V24 not found.');
  const current = supportPathsDoc.supportPaths[idx];
  const sourceTransition = (id) => incidentWorkflow.transitions.filter((t) => String(t.jiraTransitionId) === String(id));
  const requestL2 = sourceTransition('101');
  const escalateL3 = sourceTransition('171');
  supportPathsDoc.supportPaths[idx] = {
    ...current,
    name: 'Incident — live Jira API aligned L1/L2/L3 Support Path',
    description: 'Support routing rebuilt from the live Incident Jira workflow. New -> L2/L3 direct paths are origin-specific workflow actions; L1 -> L2 and L2 -> L3 are explicit routing actions.',
    movementRules: [
      {
        localId: 'request_l2',
        actionLabel: requestL2[0]?.label || 'Request to L2 Support',
        fromLevelId: 'L1',
        toLevelId: 'L2',
        movementType: 'sequential',
        targetStatusBehavior: 'explicit',
        targetStatusId: 'L2_SUPPORT',
        allowedFromStatusIds: unique(requestL2.map((t) => t.from)),
        customerEnabled: requestL2.some((t) => t.clientEnabled === true),
        roles: ['client', 'partner', 'agent', 'manager', 'admin'],
        commentRequired: true,
        reasonRequired: false,
        displayOrder: 10,
        jiraTransitionId: '101'
      },
      {
        localId: 'escalate_l3',
        actionLabel: escalateL3[0]?.label || 'Escalate to L3',
        fromLevelId: 'L2',
        toLevelId: 'L3',
        movementType: 'sequential',
        targetStatusBehavior: 'explicit',
        targetStatusId: 'L3_SUPPORT',
        allowedFromStatusIds: unique(escalateL3.map((t) => t.from)),
        customerEnabled: false,
        roles: ['partner', 'agent', 'manager', 'admin'],
        commentRequired: true,
        reasonRequired: true,
        displayOrder: 20,
        jiraTransitionId: '171'
      }
    ]
  };
  return supportPathsDoc;
}

function main() {
  const workflowsDoc = load(WORKFLOWS_FILE);
  const supportPathsDoc = load(SUPPORT_PATHS_FILE);
  const serviceModel = load(SERVICE_MODEL_FILE);

  const existingByFamily = new Map((workflowsDoc.workflows || []).map((wf) => [wf.family, wf]));
  const rebuiltByFamily = new Map();

  for (const [family, sourceFilename] of Object.entries(SOURCE_BY_FAMILY)) {
    const sourcePath = path.join(SOURCE_DIR, sourceFilename);
    if (!fs.existsSync(sourcePath)) throw new Error(`Missing Jira source snapshot: ${sourcePath}`);
    const source = load(sourcePath);
    const existing = existingByFamily.get(family);
    if (!existing) throw new Error(`Missing existing Service Manager workflow for ${family}`);
    rebuiltByFamily.set(family, rebuildWorkflow(family, source, existing, sourceFilename));
  }

  workflowsDoc.workflows = (workflowsDoc.workflows || []).map((wf) => rebuiltByFamily.get(wf.family) || wf);
  workflowsDoc.source = {
    release: VERSION,
    authority: 'Live Jira REST workflow exports',
    generatedBy: 'scripts/build-v24.2.4-workflows-from-jira.mjs',
    generatedAt: new Date().toISOString(),
    inScopeFamilies: Object.keys(SOURCE_BY_FAMILY),
    serviceRequestDeferred: true
  };

  const incident = rebuiltByFamily.get('INCIDENT');
  rebuildIncidentSupportPath(supportPathsDoc, incident);

  serviceModel.name = `SunTec SaaS Service Model v${VERSION}`;
  serviceModel.version = VERSION;
  serviceModel.ui = serviceModel.ui || {};
  serviceModel.ui.workflowAlignment = 'Live Jira REST workflow exports — Incident, Problem, Change Request, Maintenance Request';
  serviceModel.workflowSource = {
    authority: 'Jira API JSON snapshots',
    directory: 'config/v24-saas/jira-source',
    serviceRequest: 'deferred'
  };

  save(WORKFLOWS_FILE, workflowsDoc);
  save(SUPPORT_PATHS_FILE, supportPathsDoc);
  save(SERVICE_MODEL_FILE, serviceModel);

  for (const [family, workflow] of rebuiltByFamily) {
    console.log(`${family.padEnd(12)} statuses=${workflow.statuses.length} edges=${workflow.transitions.length} globals=${workflow.globalActions.length} sourceObjects=${workflow.jiraSource.sourceTransitionObjectCount}`);
  }
  console.log(`Updated ${path.relative(ROOT, WORKFLOWS_FILE)}`);
  console.log(`Updated ${path.relative(ROOT, SUPPORT_PATHS_FILE)}`);
  console.log(`Updated ${path.relative(ROOT, SERVICE_MODEL_FILE)}`);
}

main();
