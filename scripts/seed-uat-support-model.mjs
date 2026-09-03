/**
 * Service Manager v23.1.4 · UAT Support Model Seed
 *
 * Purpose
 * -------
 * Builds the UAT service-management operating model on top of the master-data
 * and users/SLA seed scripts already run for this workspace.
 *
 * Defaults for UAT differentiation:
 *   Standard Bank (STDBNK) -> Platinum
 *   Danske Bank   (DANSKE) -> Gold
 *
 * The four child clients inherit the root client's Request-family availability
 * and SLA plan.
 *
 * Source mapping
 * --------------
 * - SunTec Support Models (Feb 2021): Silver / Gold / Platinum policy values.
 * - Xelerate SaaS Incident Process Workflow V1.3:
 *     Bank=L1, Partner=L2, SunTec=L3
 *     SLA inactive at L1, active from L2/L3 after severity selection
 *     Production/DR SLA applicability
 *     Application L1 -> parallel Partner L2 + SunTec L3 support path
 *     Security/Operational/Infrastructure L2 -> L3 paths
 *     Under Monitoring, On Hold, Bank to Verify, two-stage closure, RCA visibility
 *
 * Safety
 * ------
 * - Dry-run is the default.
 * - Use --apply to write.
 * - Upserts by stable key and is safe to rerun.
 * - Preserves unrelated workflows, support paths, taxonomy rows, custom fields,
 *   client families and SLA policies.
 *
 * Usage
 * -----
 *   node scripts/seed-uat-support-model.mjs --workspace=suntecgroup --dry-run
 *   node scripts/seed-uat-support-model.mjs --workspace=suntecgroup --apply
 *
 * Optional plan overrides:
 *   --standard-plan=platinum|gold|silver|none
 *   --danske-plan=gold|platinum|silver|none
 */

import process from 'node:process';
import mongoose from 'mongoose';

import { connectDatabase, disconnectDatabase } from '../services/organization-service/src/db.js';
import { Organization } from '../services/organization-service/src/models/Organization.js';
import { Client } from '../services/organization-service/src/models/Client.js';
import { IssueType } from '../services/organization-service/src/models/IssueType.js';
import { Workflow } from '../services/organization-service/src/models/Workflow.js';
import { SupportPath } from '../services/organization-service/src/models/SupportPath.js';
import { SlaPolicy } from '../services/organization-service/src/models/SlaPolicy.js';
import { Environment } from '../services/organization-service/src/models/Environment.js';
import { REQUEST_TAXONOMY } from '../lib/v23.1.1-seed-catalogue.mjs';

const DEFAULT_WORKSPACE = 'suntecgroup';

const CLIENTS = Object.freeze({
  standard: {
    code: 'STDBNK',
    children: ['STBPPB', 'STBCIB'],
    defaultPlan: 'platinum'
  },
  danske: {
    code: 'DANSKE',
    children: ['DANPER', 'DANLCI'],
    defaultPlan: 'gold'
  }
});

const SLA_KEYS = Object.freeze({
  silver: 'SLA_SUNTEC_SILVER',
  gold: 'SLA_SUNTEC_GOLD',
  platinum: 'SLA_SUNTEC_PLATINUM'
});

function parseArgs(argv) {
  const options = {
    apply: false,
    workspace: DEFAULT_WORKSPACE,
    standardPlan: CLIENTS.standard.defaultPlan,
    danskePlan: CLIENTS.danske.defaultPlan,
    help: false
  };

  for (const arg of argv) {
    if (arg === '--apply') options.apply = true;
    else if (arg === '--dry-run') options.apply = false;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg.startsWith('--workspace=')) options.workspace = arg.slice('--workspace='.length).trim().toLowerCase();
    else if (arg.startsWith('--standard-plan=')) options.standardPlan = arg.slice('--standard-plan='.length).trim().toLowerCase();
    else if (arg.startsWith('--danske-plan=')) options.danskePlan = arg.slice('--danske-plan='.length).trim().toLowerCase();
    else throw new Error(`Unknown argument: ${arg}`);
  }

  for (const [label, value] of [['standard-plan', options.standardPlan], ['danske-plan', options.danskePlan]]) {
    if (!['silver', 'gold', 'platinum', 'none'].includes(value)) {
      throw new Error(`--${label} must be one of: silver, gold, platinum, none`);
    }
  }

  return options;
}

function printHelp() {
  console.log(`\nService Manager v23.1.4 · UAT SUPPORT MODEL SEED\n\nUsage:\n  node scripts/seed-uat-support-model.mjs --workspace=suntecgroup --dry-run\n  node scripts/seed-uat-support-model.mjs --workspace=suntecgroup --apply\n\nDefaults:\n  Standard Bank -> Platinum\n  Danske Bank   -> Gold\n\nOptions:\n  --standard-plan=platinum|gold|silver|none\n  --danske-plan=gold|platinum|silver|none\n  --dry-run   Preview only (default)\n  --apply     Write changes\n`);
}

function plain(value) {
  if (value === null || value === undefined) return value;
  if (value?.toObject) return value.toObject({ depopulate: true });
  return JSON.parse(JSON.stringify(value));
}

function same(a, b) {
  return JSON.stringify(plain(a)) === JSON.stringify(plain(b));
}

function uniqueObjectIds(values) {
  const output = [];
  const seen = new Set();
  for (const value of values || []) {
    if (!value) continue;
    const key = String(value);
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(value);
  }
  return output;
}

function task(localId, title, description, ownerSide, queue, isBlocking = true, visibility = 'internal_only', displayOrder = 10) {
  return { localId, title, description, ownerSide, queue, isBlocking, visibility, displayOrder };
}

const ESSENTIAL_INCIDENT_TASK_PATTERN = /approval|approve|verify|verification|evidence|development|develop|release|deploy|deployment|testing|test case|rca|root cause|vendor|closure|corrective action|preventive action|security incident|notify customer|customer notification/i;

function trimIncidentStatusTasks(statuses = []) {
  return statuses.map((status) => ({
    ...status,
    taskTemplates: (status.taskTemplates || []).filter((item) =>
      ESSENTIAL_INCIDENT_TASK_PATTERN.test(`${item?.title || ''} ${item?.description || ''} ${item?.queue || ''}`)
    )
  }));
}

function wfStatus(localId, name, statusType = 'normal', customerLabel = name, tasks = [], displayOrder = 100, isCustomerVisible = true) {
  return {
    localId,
    name,
    description: `${name} stage in this workflow.`,
    customerLabel,
    statusType,
    isCustomerVisible,
    isActive: true,
    displayOrder,
    taskTemplates: tasks
  };
}

function tr(fromStatusId, toStatusId) {
  return { fromStatusId, toStatusId };
}

function customField(fieldKey, label, fieldType = 'short_text', required = false, helpText = '', options = [], displayOrder = 100) {
  return {
    fieldKey: String(fieldKey).trim().toUpperCase().slice(0, 60),
    label,
    fieldType,
    required,
    helpText: String(helpText || '').slice(0, 260),
    optionsText: Array.isArray(options) ? options.join('\n').slice(0, 1200) : String(options || '').slice(0, 1200),
    displayOrder,
    status: 'active'
  };
}

const RCA_OPTIONS = [
  'Improper Requirement Analysis',
  'Improper impact analysis',
  'Improper Documentation',
  'Improper Version Management',
  'Not Following Standard Operating Procedure',
  'Improper Design',
  'Insufficient Test Coverage',
  'Knowledge Gap',
  'Improper Planning',
  'Release Packing',
  'Release Deployment',
  'Product Bugs',
  'Data Issue',
  'Environmental Issues',
  'Mistake/omission in coding',
  'Improper/Incomplete Functional Design',
  'Improper/Incomplete Technical Design'
];

const COMMON_INCIDENT_FIELDS = [
  customField('RELEASE_ID', 'Release ID', 'short_text', false, 'Issue release ID, when a release is required.', [], 60),
  customField('RELEASE_TYPE', 'Release Type', 'dropdown', false, 'Set by support when a release is required.', ['Emergency', 'Normal'], 70),
  customField('S3_BUCKET_URL', 'S3 Bucket URL', 'url', false, 'Use an approved S3 link for screenshots, logs and incident evidence.', [], 80),
  customField('TEST_CASE_LINK', 'Test Case Link', 'url', false, 'Internal repository link for relevant test cases.', [], 90),
  customField('REMARKS', 'Remarks', 'long_text', false, 'Additional incident notes.', [], 100),
  customField('RCA_CATEGORY', 'RCA Category', 'dropdown', false, 'RCA category; completed RCA is intended to be customer-visible.', RCA_OPTIONS, 200),
  customField('ROOT_CAUSE', 'Root Cause', 'long_text', false, 'Root cause analysis.', [], 210),
  customField('CORRECTIVE_ACTION', 'Corrective Action', 'long_text', false, 'Corrective action taken.', [], 220),
  customField('PREVENTIVE_ACTION', 'Preventive Action', 'long_text', false, 'Preventive action planned or completed.', [], 230),
  customField('RCA_STATUS', 'RCA Status', 'dropdown', false, '', ['Open', 'In Progress', 'Closed'], 240),
  customField('APPROVER', 'Approver', 'short_text', false, 'Approver for production movement or closure where applicable.', [], 250),
  customField('EXCEPTION_APPROVER', 'Exception Approver', 'short_text', false, 'Alternative approver when the normal approver is unavailable.', [], 260)
];

const INCIDENT_FIELDS = Object.freeze({
  APPLICATION: [
    customField('INCIDENT_SUBTYPE', 'Incident Subtype', 'dropdown', false, 'Classify the Application incident.', [
      'UI Functional Issue', 'Application Server Issue', 'User Access Issue', 'Password Issue', 'Business Data Issue',
      'Library Data Issue', 'System Configuration Issue', 'Functional Issue', 'Batch Processing Issue', 'DB Data Issue',
      'Process Container Issue', 'Suspense Processing Issue', 'DB Data Level Issue', 'Database Issue', 'API Issue',
      'UI Performance Issue', 'Batch Performance Issue', 'API Performance Issue'
    ], 10),
    ...COMMON_INCIDENT_FIELDS
  ],
  SECURITY: [
    customField('INCIDENT_SUBTYPE', 'Incident Subtype', 'dropdown', false, 'Classify the Security incident.', [
      'Unauthorised Access or Unsuccessful Access Attempts', 'Privileged/System Account Monitoring Issue',
      'AWS Shield or Security Monitoring Alert', 'Sensitive Data Access', 'Denial of Service (DoS/DDoS)',
      'Malicious Code / Malware', 'Network Related Security Attack', 'Unauthorized Data Deletion/Modification',
      'Application Attack'
    ], 10),
    ...COMMON_INCIDENT_FIELDS
  ],
  OPERATIONAL: [
    customField('INCIDENT_SUBTYPE', 'Incident Subtype', 'dropdown', false, 'Classify the Operational incident.', [
      'Patch Application Issue', 'Report Issue', 'Batch Process Issue', 'CI/CD Pipeline Issue', 'Email Issue',
      'Ticketing Tool Issue', 'Environment Access Issue', 'Monitoring Tool Issue', 'DR Issue'
    ], 10),
    ...COMMON_INCIDENT_FIELDS
  ],
  INFRASTRUCTURE: [
    customField('INCIDENT_SUBTYPE', 'Incident Subtype', 'dropdown', false, 'Classify the Infrastructure incident.', [
      'VM Down', 'Monitoring Tool Down', 'Network Firewall Down', 'SIEM Tool Down', 'AWS Service Down', 'EKS Down',
      'RDS Down', 'Infrastructure Deployment Issue', 'Jenkins Down', 'Controller Down', 'Bastion Host Down',
      'Admin Server Down', 'VPC Peering Issue', 'Site-to-Site Tunnel Issue', 'OS Patching Issue',
      'Network Connectivity Issue'
    ], 10),
    ...COMMON_INCIDENT_FIELDS
  ]
});

function pauseStatuses(prefix, ownerSide, queue, visibility, baseOrder = 800) {
  return [
    wfStatus('on_hold', 'On Hold', 'hold', 'On Hold', [
      task(`${prefix}_hold`, 'Record hold reason', 'Record the dependency, owner and expected resume point.', ownerSide, queue, false, visibility, 10)
    ], baseOrder),
    wfStatus('under_monitoring', 'Under Monitoring', 'waiting', 'Under Monitoring', [
      task(`${prefix}_monitor`, 'Monitor service condition', 'Monitor for recurrence and record observations before resuming work.', ownerSide, queue, true, visibility, 10)
    ], baseOrder + 10),
    wfStatus('deferred', 'Deferred', 'hold', 'Deferred', [
      task(`${prefix}_defer`, 'Record deferral details', 'Record the reason, dependency, review date and accountable owner.', ownerSide, queue, false, visibility, 10)
    ], baseOrder + 20)
  ];
}

function closureStatuses(prefix, ownerSide, queue, baseOrder = 900) {
  return [
    wfStatus('resolved', 'Resolved', 'resolved', 'Resolved', [
      task(`${prefix}_resolution_summary`, 'Record final resolution', 'Document the final or temporary resolution, evidence and service restoration time.', ownerSide, queue, true, 'client_visible', 10),
      task(`${prefix}_rca`, 'Complete RCA', 'Record RCA category, root cause, corrective action, preventive action and RCA status.', ownerSide, queue, true, 'client_visible', 20),
      task(`${prefix}_closure_ready`, 'Confirm closure readiness', 'Confirm verification, RCA and blocking work are complete before closure approval.', ownerSide, queue, true, 'client_visible', 30)
    ], baseOrder),
    wfStatus('pending_close', 'Pending Closure Approval', 'waiting', 'Closure Approval Pending', [
      task(`${prefix}_close_approval`, 'Review and approve closure', 'SunTec Global Support reviews resolution, verification, RCA and open actions before approving closure.', 'suntec', 'SunTec Global Support', true, 'internal_only', 10)
    ], baseOrder + 10),
    wfStatus('approved_close', 'Approved to Close', 'normal', 'Approved for Closure', [
      task(`${prefix}_final_close`, 'Complete final closure', 'Record final closure after approval.', ownerSide, queue, true, 'client_visible', 10)
    ], baseOrder + 20),
    wfStatus('closed', 'Closed', 'final', 'Closed', [], baseOrder + 30)
  ];
}

function environmentStatus(prefix, localId, name, ownerSide, queue, order, visibility) {
  return wfStatus(localId, name, 'normal', name, [
    task(`${prefix}_${localId}_approval`, 'Confirm required approval', `Confirm the required approval before ${name.toLowerCase()}.`, ownerSide, queue, true, visibility, 10),
    task(`${prefix}_${localId}_work`, `Complete ${name.toLowerCase()}`, `Perform ${name.toLowerCase()} and record result and evidence.`, ownerSide, queue, true, visibility === 'internal_only' ? 'internal_only' : 'client_visible', 20)
  ], order);
}

function addPauseTransitions(transitions) {
  for (const from of ['analysis', 'resolution']) {
    transitions.push(tr(from, 'on_hold'), tr(from, 'under_monitoring'), tr(from, 'deferred'));
  }
  // v23.1 workflow data is state-based and cannot enforce the source document's
  // history-dependent "immediately preceding status only" reversion rule by itself.
  // These transitions keep the states usable; runtime enforcement can be added later.
  for (const paused of ['on_hold', 'under_monitoring', 'deferred']) {
    transitions.push(tr(paused, 'analysis'), tr(paused, 'resolution'));
  }
}

function buildIncidentWorkflow({ key, name, description, prefix, ownerSide, queue, level, security = false, includeDevelopment = false, includeVendor = false, includeBankVerify = false }) {
  const visibility = ownerSide === 'client' ? 'client_visible' : ownerSide === 'partner' ? 'partner_visible' : 'internal_only';
  const l1 = level === 'L1';

  const statuses = [
    wfStatus('new', 'New', 'start', 'New', [], 10),
    wfStatus('assigned', 'Assigned', 'normal', ownerSide === 'client' ? 'Under Review' : 'Assigned', [
      task(`${prefix}_accept`, 'Accept ownership', 'Confirm ownership and responsible engineer/team.', ownerSide, queue, true, visibility, 10),
      task(`${prefix}_validate`, 'Validate incident context', 'Validate severity, environment, product/module, description and available evidence.', ownerSide, queue, true, 'client_visible', 20)
    ], 20),
    wfStatus('analysis', 'Analysis', 'normal', 'Under Analysis', [
      task(`${prefix}_analyse`, 'Perform incident analysis', 'Investigate the issue and identify the likely resolution path.', ownerSide, queue, true, visibility, 10),
      task(`${prefix}_findings`, 'Record analysis findings', 'Record findings, evidence, workaround and escalation requirement.', ownerSide, queue, true, 'client_visible', 20),
      ...(security ? [task(`${prefix}_security_notify`, 'Notify customer of security incident', 'Notify the customer of the confirmed security incident and expected resolution timeframe based on severity.', ownerSide, queue, true, 'client_visible', 30)] : [])
    ], 30),
    wfStatus('resolution', 'Resolution', 'normal', 'Resolution in Progress', [
      task(`${prefix}_resolve`, 'Perform resolution activity', 'Apply or provide the supported correction, workaround, restart or remediation.', ownerSide, queue, true, visibility, 10),
      task(`${prefix}_evidence`, 'Record resolution evidence', 'Record action, result, evidence, remaining risk and next verification step.', ownerSide, queue, true, 'client_visible', 20)
    ], 40)
  ];

  if (includeVendor) {
    statuses.push(wfStatus('vendor_support', 'Vendor Support', 'waiting', 'Vendor Support', [
      task(`${prefix}_vendor_case`, 'Raise vendor support case', 'Record vendor case ID, priority, evidence and next commitment.', 'internal', 'Vendor Coordination', true, 'internal_only', 10),
      task(`${prefix}_vendor_update`, 'Record vendor response', 'Record vendor findings, workaround, recommendation and next action.', 'internal', 'Vendor Coordination', true, 'partner_visible', 20)
    ], 45));
  }

  if (includeDevelopment) {
    statuses.push(
      wfStatus('development', 'Development', 'normal', 'Engineering Fix', [
        task(`${prefix}_dev`, 'Implement fix', 'Implement and internally test the required product/platform fix and link the internal work item.', 'suntec', 'Product / Platform Engineering', true, 'internal_only', 10)
      ], 50),
      wfStatus('release', 'Release', 'normal', 'Release Preparation', [
        task(`${prefix}_release`, 'Prepare approved release', 'Record release ID/type, test evidence, deployment sequence and rollback plan.', 'suntec', 'Release Management', true, 'partner_visible', 10)
      ], 60)
    );
  }

  if (l1) {
    statuses.push(
      environmentStatus(prefix, 'verify_preprod', 'Verify in Preproduction', ownerSide, queue, 100, 'client_visible'),
      environmentStatus(prefix, 'deploy_prod_dr', 'Deploy to Production/DR', ownerSide, queue, 110, 'client_visible'),
      wfStatus('verification_complete', 'Verification Complete', 'normal', 'Verification Complete', [
        task(`${prefix}_verify_complete`, 'Confirm verification complete', 'Confirm resolution in the required environment and record evidence.', ownerSide, queue, true, 'client_visible', 10)
      ], 120)
    );
  } else {
    statuses.push(
      environmentStatus(prefix, 'verify_build', 'Verify in Build', ownerSide, queue, 100, visibility),
      environmentStatus(prefix, 'verify_quality', 'Verify in Quality', ownerSide, queue, 110, visibility),
      environmentStatus(prefix, 'verify_stage', 'Verify in Stage', ownerSide, queue, 120, visibility),
      environmentStatus(prefix, 'verify_preprod', 'Verify in Preproduction', ownerSide, queue, 130, visibility),
      environmentStatus(prefix, 'deploy_prod_dr', 'Deploy to Production/DR', ownerSide, queue, 140, visibility)
    );

    if (includeBankVerify) {
      statuses.push(wfStatus('bank_verify', 'Bank to Verify', 'waiting', 'Awaiting Bank Verification', [
        task(`${prefix}_bank_instructions`, 'Provide Bank verification instructions', 'Comments must clearly state what the Bank must verify, the environment and expected result.', ownerSide, queue, true, 'client_visible', 10),
        task(`${prefix}_bank_result`, 'Record Bank verification outcome', 'Bank records verification outcome and comments before returning the incident to support.', 'client', 'Bank Verification', true, 'client_visible', 20)
      ], 150));
    }

    statuses.push(wfStatus('verification_complete', 'Verification Complete', 'normal', 'Verification Complete', [
      task(`${prefix}_verification_complete`, 'Confirm verification complete', 'Confirm successful verification and record the final result.', ownerSide, queue, true, 'client_visible', 10)
    ], includeBankVerify ? 160 : 150));
  }

  statuses.push(...pauseStatuses(prefix, ownerSide, queue, visibility, 800));
  statuses.push(
    wfStatus('duplicate', 'Duplicate', 'final', 'Duplicate', [], 840),
    wfStatus('not_issue', 'Not an Issue', 'final', 'Not an Issue', [], 850),
    wfStatus('cancelled', 'Cancelled', 'cancelled', 'Cancelled', [], 860)
  );
  statuses.push(...closureStatuses(prefix, ownerSide, queue, 900));

  const transitions = [
    tr('new', 'assigned'),
    tr('assigned', 'analysis'),
    tr('analysis', 'resolution'),
    tr('analysis', 'duplicate'),
    tr('analysis', 'not_issue'),
    tr('analysis', 'cancelled')
  ];
  addPauseTransitions(transitions);

  if (includeVendor) {
    transitions.push(tr('analysis', 'vendor_support'), tr('resolution', 'vendor_support'), tr('vendor_support', 'analysis'), tr('vendor_support', 'resolution'));
  }

  const envs = l1
    ? ['verify_preprod', 'deploy_prod_dr', 'verification_complete']
    : ['verify_build', 'verify_quality', 'verify_stage', 'verify_preprod', 'deploy_prod_dr', ...(includeBankVerify ? ['bank_verify'] : []), 'verification_complete'];

  let startForEnvironment = 'resolution';
  if (includeDevelopment) {
    transitions.push(tr('resolution', 'development'), tr('development', 'release'));
    startForEnvironment = 'release';
  }

  for (let i = 0; i < envs.length; i += 1) {
    transitions.push(tr(i === 0 ? startForEnvironment : envs[i - 1], envs[i]));
    if (i > 0) transitions.push(tr(startForEnvironment, envs[i]));
  }

  for (const env of envs.filter((id) => id !== 'verification_complete')) transitions.push(tr(env, 'analysis'));
  if (includeBankVerify) transitions.push(tr('bank_verify', 'resolution'));

  // Fast path: workaround/configuration/restart resolves the incident without a release train.
  transitions.push(tr('resolution', 'resolved'));
  transitions.push(tr('verification_complete', 'resolved'));
  transitions.push(tr('resolved', 'pending_close'), tr('pending_close', 'approved_close'), tr('pending_close', 'analysis'), tr('approved_close', 'closed'));

  return { key, name, description, statuses: trimIncidentStatusTasks(statuses), transitions };
}

function serviceRequestWorkflow({ key, name, ownerSide, queue }) {
  const visibility = ownerSide === 'client' ? 'client_visible' : ownerSide === 'partner' ? 'partner_visible' : 'internal_only';
  const prefix = key.toLowerCase().slice(0, 32);
  const statuses = [
    wfStatus('new', 'New', 'start', 'New', [], 10),
    wfStatus('assigned', 'Assigned', 'normal', 'Assigned', [task(`${prefix}_accept`, 'Accept service request', 'Confirm ownership and routing.', ownerSide, queue, true, visibility, 10)], 20),
    wfStatus('analysis', 'Analysis', 'normal', 'Under Review', [task(`${prefix}_analyse`, 'Analyse request', 'Validate request, information, dependencies and fulfilment route.', ownerSide, queue, true, visibility, 10)], 30),
    wfStatus('need_info', 'Need Information', 'waiting', 'More Information Required', [], 40),
    wfStatus('pending_approval', 'Pending Approval', 'waiting', 'Pending Approval', [task(`${prefix}_approval`, 'Obtain approval', 'Record required approval before fulfilment.', ownerSide, queue, true, visibility, 10)], 50),
    wfStatus('approved', 'Approved', 'normal', 'Approved', [], 60),
    wfStatus('in_progress', 'In Progress', 'normal', 'In Progress', [task(`${prefix}_fulfil`, 'Fulfil request', 'Perform the approved service request and record evidence.', ownerSide, queue, true, visibility, 10)], 70),
    wfStatus('verification', 'Verification', 'normal', 'Verification', [task(`${prefix}_verify`, 'Verify fulfilment', 'Verify the requested outcome and record confirmation.', ownerSide, queue, true, 'client_visible', 10)], 80),
    wfStatus('completed', 'Completed', 'resolved', 'Completed', [], 90),
    wfStatus('on_hold', 'On Hold', 'hold', 'On Hold', [], 100),
    wfStatus('cancelled', 'Cancelled', 'cancelled', 'Cancelled', [], 110),
    wfStatus('closed', 'Closed', 'final', 'Closed', [], 120)
  ];
  const transitions = [
    tr('new', 'assigned'), tr('assigned', 'analysis'), tr('analysis', 'need_info'), tr('need_info', 'analysis'),
    tr('analysis', 'pending_approval'), tr('analysis', 'in_progress'), tr('analysis', 'on_hold'), tr('analysis', 'cancelled'),
    tr('pending_approval', 'approved'), tr('pending_approval', 'need_info'), tr('approved', 'in_progress'),
    tr('in_progress', 'verification'), tr('verification', 'in_progress'), tr('verification', 'completed'),
    tr('completed', 'closed'), tr('on_hold', 'analysis')
  ];
  return { key, name, description: `${name} workflow for UAT service fulfilment.`, statuses, transitions };
}

function changeWorkflow({ key, name, ownerSide, queue }) {
  const visibility = ownerSide === 'client' ? 'client_visible' : ownerSide === 'partner' ? 'partner_visible' : 'internal_only';
  const prefix = key.toLowerCase().slice(0, 32);
  const statuses = [
    wfStatus('new', 'New', 'start', 'New', [], 10),
    wfStatus('assigned', 'Assigned', 'normal', 'Assigned', [], 20),
    wfStatus('assessment', 'Assessment', 'normal', 'Assessment', [task(`${prefix}_assess`, 'Assess change', 'Assess purpose, feasibility, dependencies and affected services.', ownerSide, queue, true, visibility, 10)], 30),
    wfStatus('need_info', 'Need Information', 'waiting', 'More Information Required', [], 40),
    wfStatus('impact', 'Impact Analysis', 'normal', 'Impact Analysis', [task(`${prefix}_impact`, 'Complete impact analysis', 'Document impact, risk, outage expectation, testing and rollback.', ownerSide, queue, true, visibility, 10)], 50),
    wfStatus('change_plan', 'Change Plan', 'normal', 'Change Planning', [], 60),
    wfStatus('pending_approval', 'Pending Approval', 'waiting', 'Pending Approval', [], 70),
    wfStatus('approved', 'Approved', 'normal', 'Approved', [], 80),
    wfStatus('scheduled', 'Scheduled', 'waiting', 'Scheduled', [], 90),
    wfStatus('implementation', 'Implementation', 'normal', 'Implementation in Progress', [], 100),
    wfStatus('verification', 'Verification', 'normal', 'Verification', [], 110),
    wfStatus('rollback', 'Rollback', 'normal', 'Rollback in Progress', [], 120),
    wfStatus('completed', 'Completed', 'resolved', 'Completed', [], 130),
    wfStatus('on_hold', 'On Hold', 'hold', 'On Hold', [], 140),
    wfStatus('cancelled', 'Cancelled', 'cancelled', 'Cancelled', [], 150),
    wfStatus('closed', 'Closed', 'final', 'Closed', [], 160)
  ];
  const transitions = [
    tr('new', 'assigned'), tr('assigned', 'assessment'), tr('assessment', 'need_info'), tr('need_info', 'assessment'),
    tr('assessment', 'impact'), tr('assessment', 'on_hold'), tr('assessment', 'cancelled'), tr('impact', 'change_plan'),
    tr('change_plan', 'pending_approval'), tr('pending_approval', 'approved'), tr('pending_approval', 'need_info'),
    tr('approved', 'scheduled'), tr('scheduled', 'implementation'), tr('implementation', 'verification'),
    tr('implementation', 'rollback'), tr('verification', 'completed'), tr('verification', 'rollback'),
    tr('rollback', 'assessment'), tr('completed', 'closed'), tr('on_hold', 'assessment')
  ];
  return { key, name, description: `${name} controlled-change workflow for UAT.`, statuses, transitions };
}

function maintenanceWorkflow({ key, name, ownerSide, queue }) {
  const visibility = ownerSide === 'partner' ? 'partner_visible' : 'internal_only';
  const prefix = key.toLowerCase().slice(0, 32);
  const statuses = [
    wfStatus('new', 'New', 'start', 'New', [], 10),
    wfStatus('assigned', 'Assigned', 'normal', 'Assigned', [], 20),
    wfStatus('assessment', 'Assessment', 'normal', 'Assessment', [task(`${prefix}_assess`, 'Assess maintenance', 'Validate maintenance scope, impact, dependencies and rollback.', ownerSide, queue, true, visibility, 10)], 30),
    wfStatus('pending_approval', 'Pending Approval', 'waiting', 'Pending Approval', [], 40),
    wfStatus('scheduled', 'Scheduled', 'waiting', 'Scheduled', [], 50),
    wfStatus('execution', 'Execution', 'normal', 'Maintenance in Progress', [], 60),
    wfStatus('verification', 'Verification', 'normal', 'Verification', [], 70),
    wfStatus('completed', 'Completed', 'resolved', 'Completed', [], 80),
    wfStatus('on_hold', 'On Hold', 'hold', 'On Hold', [], 90),
    wfStatus('cancelled', 'Cancelled', 'cancelled', 'Cancelled', [], 100),
    wfStatus('closed', 'Closed', 'final', 'Closed', [], 110)
  ];
  const transitions = [
    tr('new', 'assigned'), tr('assigned', 'assessment'), tr('assessment', 'pending_approval'), tr('assessment', 'on_hold'),
    tr('assessment', 'cancelled'), tr('pending_approval', 'scheduled'), tr('scheduled', 'execution'),
    tr('execution', 'verification'), tr('verification', 'execution'), tr('verification', 'completed'),
    tr('completed', 'closed'), tr('on_hold', 'assessment')
  ];
  return { key, name, description: `${name} workflow for planned/emergency maintenance activities.`, statuses, transitions };
}

function problemWorkflow() {
  const statuses = [
    wfStatus('new', 'New', 'start', 'New', [], 10),
    wfStatus('assigned', 'Assigned', 'normal', 'Assigned', [], 20),
    wfStatus('analysis', 'Analysis', 'normal', 'Problem Analysis', [], 30),
    wfStatus('rca', 'Root Cause Analysis', 'normal', 'Root Cause Analysis', [task('problem_rca', 'Complete RCA', 'Identify and document the permanent root cause.', 'suntec', 'SunTec Product / Platform', true, 'client_visible', 10)], 40),
    wfStatus('fix_plan', 'Fix Planning', 'normal', 'Fix Planning', [], 50),
    wfStatus('fix_progress', 'Fix in Progress', 'normal', 'Fix in Progress', [], 60),
    wfStatus('verification', 'Verification', 'normal', 'Verification', [], 70),
    wfStatus('resolved', 'Resolved', 'resolved', 'Resolved', [], 80),
    wfStatus('on_hold', 'On Hold', 'hold', 'On Hold', [], 90),
    wfStatus('closed', 'Closed', 'final', 'Closed', [], 100)
  ];
  const transitions = [
    tr('new', 'assigned'), tr('assigned', 'analysis'), tr('analysis', 'rca'), tr('analysis', 'on_hold'),
    tr('on_hold', 'analysis'), tr('rca', 'fix_plan'), tr('fix_plan', 'fix_progress'),
    tr('fix_progress', 'verification'), tr('verification', 'fix_progress'), tr('verification', 'resolved'), tr('resolved', 'closed')
  ];
  return { key: 'WF_PROBLEM_L3', name: 'Problem Management – SunTec L3', description: 'Problem workflow for permanent RCA and fix after one or more incidents.', statuses, transitions };
}

function queryWorkflow() {
  const statuses = [
    wfStatus('new', 'New', 'start', 'New', [], 10),
    wfStatus('assigned', 'Assigned', 'normal', 'Assigned', [], 20),
    wfStatus('need_info', 'Need Information', 'waiting', 'More Information Required', [], 30),
    wfStatus('answered', 'Response Provided', 'resolved', 'Response Provided', [], 40),
    wfStatus('closed', 'Closed', 'final', 'Closed', [], 50)
  ];
  return {
    key: 'WF_QUERY_L1',
    name: 'Query – Bank L1',
    description: 'Simple information/assistance query workflow for Bank L1.',
    statuses,
    transitions: [tr('new', 'assigned'), tr('assigned', 'need_info'), tr('need_info', 'assigned'), tr('assigned', 'answered'), tr('answered', 'closed')]
  };
}

const WORKFLOW_DEFS = [
  buildIncidentWorkflow({ key: 'WF_INC_APP_L1', name: 'Application Incident – L1 Bank', description: 'Bank-owned L1 application incident analysis, resolution, verification and closure workflow.', prefix: 'app_l1', ownerSide: 'client', queue: 'Bank Service Desk', level: 'L1' }),
  buildIncidentWorkflow({ key: 'WF_INC_APP_L2', name: 'Application Incident – L2 Partner', description: 'Partner-owned L2 application incident workflow with verification, Bank verification, RCA and closure approval.', prefix: 'app_l2', ownerSide: 'partner', queue: 'Partner L2 Support', level: 'L2', includeBankVerify: true }),
  buildIncidentWorkflow({ key: 'WF_INC_APP_L3', name: 'Application Incident – L3 SunTec', description: 'SunTec L3 application incident workflow covering advanced analysis, development, release, client-environment deployment, Bank verification, RCA and closure.', prefix: 'app_l3', ownerSide: 'suntec', queue: 'SunTec L3 Support', level: 'L3', includeDevelopment: true, includeBankVerify: true }),
  buildIncidentWorkflow({ key: 'WF_INC_SEC_L2', name: 'Security Incident – L2 Partner', description: 'Partner L2 security incident workflow with customer notification, remediation, verification, RCA and closure.', prefix: 'sec_l2', ownerSide: 'partner', queue: 'Partner Security Operations', level: 'L2', security: true }),
  buildIncidentWorkflow({ key: 'WF_INC_SEC_L3', name: 'Security Incident – L3 SunTec', description: 'SunTec L3 security incident workflow with notification, engineering remediation, release, verification, RCA and closure.', prefix: 'sec_l3', ownerSide: 'suntec', queue: 'SunTec Security Support', level: 'L3', security: true, includeDevelopment: true }),
  buildIncidentWorkflow({ key: 'WF_INC_OPS_L2', name: 'Operational Incident – L2 Partner', description: 'Partner L2 operational incident workflow for managed-service incidents and escalation to SunTec.', prefix: 'ops_l2', ownerSide: 'partner', queue: 'Partner Operations', level: 'L2' }),
  buildIncidentWorkflow({ key: 'WF_INC_OPS_L3', name: 'Operational Incident – L3 SunTec', description: 'SunTec L3 operational incident workflow with remediation, release, verification, RCA and closure.', prefix: 'ops_l3', ownerSide: 'suntec', queue: 'SunTec Operations Support', level: 'L3', includeDevelopment: true }),
  buildIncidentWorkflow({ key: 'WF_INC_INF_L2', name: 'Infrastructure Incident – L2 Partner', description: 'Partner L2 infrastructure incident workflow for restoration, rollback, verification and SunTec escalation.', prefix: 'inf_l2', ownerSide: 'partner', queue: 'Partner Infrastructure Operations', level: 'L2' }),
  buildIncidentWorkflow({ key: 'WF_INC_INF_L3', name: 'Infrastructure Incident – L3 SunTec', description: 'SunTec L3 infrastructure incident workflow covering advanced diagnosis, vendor support, platform fixes, release, verification, RCA and closure.', prefix: 'inf_l3', ownerSide: 'suntec', queue: 'SunTec Infrastructure Support', level: 'L3', includeDevelopment: true, includeVendor: true }),

  serviceRequestWorkflow({ key: 'WF_SR_L1', name: 'Service Request – L1 Bank', ownerSide: 'client', queue: 'Bank Service Desk' }),
  serviceRequestWorkflow({ key: 'WF_SR_L2', name: 'Service Request – L2 Partner', ownerSide: 'partner', queue: 'Partner Support' }),
  serviceRequestWorkflow({ key: 'WF_SR_L3', name: 'Service Request – L3 SunTec', ownerSide: 'suntec', queue: 'SunTec Service Fulfilment' }),

  maintenanceWorkflow({ key: 'WF_MAINT_L2', name: 'Maintenance Request – L2 Partner', ownerSide: 'partner', queue: 'Partner Operations' }),
  maintenanceWorkflow({ key: 'WF_MAINT_L3', name: 'Maintenance Request – L3 SunTec', ownerSide: 'suntec', queue: 'SunTec Operations' }),

  changeWorkflow({ key: 'WF_CHANGE_L1', name: 'Change Request – L1 Bank', ownerSide: 'client', queue: 'Bank Service Desk' }),
  changeWorkflow({ key: 'WF_CHANGE_L2', name: 'Change Request – L2 Partner', ownerSide: 'partner', queue: 'Partner Support' }),
  changeWorkflow({ key: 'WF_CHANGE_L3', name: 'Change Request – L3 SunTec', ownerSide: 'suntec', queue: 'SunTec Change Support' }),

  problemWorkflow(),
  queryWorkflow()
];

function level(localId, label, ownerSide, slaApplicable, displayOrder, workflowKey) {
  return { localId, label, ownerSide, slaApplicable, displayOrder, workflowKey };
}

function move(localId, actionLabel, fromLevelId, toLevelIds, movementType = 'sequential', primaryLevelId = '', displayOrder = 10) {
  const targets = Array.isArray(toLevelIds) ? toLevelIds : [toLevelIds];
  return {
    localId,
    actionLabel,
    fromLevelId,
    toLevelId: targets[0],
    movementType,
    targetStatusBehavior: 'start',
    toLevelIds: targets,
    primaryLevelId: primaryLevelId || targets[0],
    commentRequired: true,
    reasonRequired: true,
    displayOrder
  };
}

const SUPPORT_PATH_DEFS = [
  {
    key: 'PATH_INC_APP_STANDARD',
    name: 'Application Incident – Standard Support Path',
    description: 'Bank L1 triage followed by Partner L2 and SunTec L3 escalation when required.',
    levels: [
      level('L1', 'L1 · Bank', 'client', false, 10, 'WF_INC_APP_L1'),
      level('L2', 'L2 · Partner', 'partner', true, 20, 'WF_INC_APP_L2'),
      level('L3', 'L3 · SunTec Support', 'suntec', true, 30, 'WF_INC_APP_L3')
    ],
    movementRules: [
      move('app_l1_l2', 'Send to Partner L2', 'L1', 'L2', 'sequential', 'L2', 10),
      move('app_l2_l1', 'Send back to Bank', 'L2', 'L1', 'sequential', 'L1', 15),
      move('app_l2_l3', 'Escalate to SunTec L3', 'L2', 'L3', 'sequential', 'L3', 20),
      move('app_l3_l2', 'Return to Partner L2', 'L3', 'L2', 'sequential', 'L2', 25),
      move('app_l3_l1', 'Send to Bank', 'L3', 'L1', 'sequential', 'L1', 30)
    ]
  },
  {
    key: 'PATH_INC_APP_PARALLEL',
    name: 'Application Incident – L2 + L3 Parallel Support Path',
    description: 'Bank L1 triage followed by simultaneous Partner L2 and SunTec L3 work, with L2 primary.',
    levels: [
      level('L1', 'L1 · Bank', 'client', false, 10, 'WF_INC_APP_L1'),
      level('L2', 'L2 · Partner', 'partner', true, 20, 'WF_INC_APP_L2'),
      level('L3', 'L3 · SunTec Support', 'suntec', true, 30, 'WF_INC_APP_L3')
    ],
    movementRules: [
      move('app_l1_parallel', 'Start L2 + L3', 'L1', ['L2', 'L3'], 'parallel', 'L2', 10),
      move('app_l2_l1', 'Send back to Bank', 'L2', 'L1', 'sequential', 'L1', 15),
      move('app_l2_l3', 'Escalate to SunTec L3', 'L2', 'L3', 'sequential', 'L3', 20),
      move('app_l3_l2', 'Return to Partner L2', 'L3', 'L2', 'sequential', 'L2', 25),
      move('app_l3_l1', 'Send to Bank', 'L3', 'L1', 'sequential', 'L1', 30)
    ]
  },
  {
    key: 'PATH_INC_SEC_STANDARD',
    name: 'Security Incident – Partner to SunTec',
    description: 'Partner L2 security response with escalation to SunTec L3 when required.',
    levels: [
      level('L2', 'L2 · Partner Security', 'partner', true, 10, 'WF_INC_SEC_L2'),
      level('L3', 'L3 · SunTec Security', 'suntec', true, 20, 'WF_INC_SEC_L3')
    ],
    movementRules: [
      move('sec_l2_l3', 'Escalate to SunTec L3', 'L2', 'L3', 'sequential', 'L3', 10),
      move('sec_l3_l2', 'Return to Partner L2', 'L3', 'L2', 'sequential', 'L2', 20)
    ]
  },
  {
    key: 'PATH_INC_OPS_STANDARD',
    name: 'Operational Incident – Partner to SunTec',
    description: 'Partner L2 operational response with escalation to SunTec L3 when required.',
    levels: [
      level('L2', 'L2 · Partner Operations', 'partner', true, 10, 'WF_INC_OPS_L2'),
      level('L3', 'L3 · SunTec Operations', 'suntec', true, 20, 'WF_INC_OPS_L3')
    ],
    movementRules: [
      move('ops_l2_l3', 'Escalate to SunTec L3', 'L2', 'L3', 'sequential', 'L3', 10),
      move('ops_l3_l2', 'Return to Partner L2', 'L3', 'L2', 'sequential', 'L2', 20)
    ]
  },
  {
    key: 'PATH_INC_INF_STANDARD',
    name: 'Infrastructure Incident – Partner to SunTec',
    description: 'Partner L2 infrastructure response with escalation to SunTec L3/vendor coordination when required.',
    levels: [
      level('L2', 'L2 · Partner Infrastructure', 'partner', true, 10, 'WF_INC_INF_L2'),
      level('L3', 'L3 · SunTec Infrastructure', 'suntec', true, 20, 'WF_INC_INF_L3')
    ],
    movementRules: [
      move('inf_l2_l3', 'Escalate to SunTec L3', 'L2', 'L3', 'sequential', 'L3', 10),
      move('inf_l3_l2', 'Return to Partner L2', 'L3', 'L2', 'sequential', 'L2', 20)
    ]
  },
  {
    key: 'PATH_SR_STANDARD',
    name: 'Service Request – Standard Fulfilment Path',
    description: 'Service Request path from Bank L1 through Partner L2 and optional SunTec L3 fulfilment.',
    levels: [
      level('L1', 'L1 · Bank', 'client', false, 10, 'WF_SR_L1'),
      level('L2', 'L2 · Partner', 'partner', false, 20, 'WF_SR_L2'),
      level('L3', 'L3 · SunTec', 'suntec', false, 30, 'WF_SR_L3')
    ],
    movementRules: [
      move('sr_l1_l2', 'Send to Partner L2', 'L1', 'L2', 'sequential', 'L2', 10),
      move('sr_l2_l1', 'Send back to Bank', 'L2', 'L1', 'sequential', 'L1', 15),
      move('sr_l2_l3', 'Send to SunTec L3', 'L2', 'L3', 'sequential', 'L3', 20),
      move('sr_l3_l2', 'Return to Partner L2', 'L3', 'L2', 'sequential', 'L2', 25),
      move('sr_l3_l1', 'Send to Bank', 'L3', 'L1', 'sequential', 'L1', 30)
    ]
  },
  {
    key: 'PATH_MAINT_STANDARD',
    name: 'Maintenance Request – Partner to SunTec',
    description: 'Maintenance path from Partner L2 to SunTec L3 when SunTec support is required.',
    levels: [
      level('L2', 'L2 · Partner Operations', 'partner', false, 10, 'WF_MAINT_L2'),
      level('L3', 'L3 · SunTec Operations', 'suntec', false, 20, 'WF_MAINT_L3')
    ],
    movementRules: [
      move('maint_l2_l3', 'Send to SunTec L3', 'L2', 'L3', 'sequential', 'L3', 10),
      move('maint_l3_l2', 'Return to Partner L2', 'L3', 'L2', 'sequential', 'L2', 20)
    ]
  },
  {
    key: 'PATH_CHANGE_STANDARD',
    name: 'Change Request – Controlled Change Path',
    description: 'Controlled change path across Bank L1, Partner L2 and optional SunTec L3 involvement.',
    levels: [
      level('L1', 'L1 · Bank', 'client', false, 10, 'WF_CHANGE_L1'),
      level('L2', 'L2 · Partner', 'partner', false, 20, 'WF_CHANGE_L2'),
      level('L3', 'L3 · SunTec', 'suntec', false, 30, 'WF_CHANGE_L3')
    ],
    movementRules: [
      move('chg_l1_l2', 'Send to Partner L2', 'L1', 'L2', 'sequential', 'L2', 10),
      move('chg_l2_l1', 'Send back to Bank', 'L2', 'L1', 'sequential', 'L1', 15),
      move('chg_l2_l3', 'Send to SunTec L3', 'L2', 'L3', 'sequential', 'L3', 20),
      move('chg_l3_l2', 'Return to Partner L2', 'L3', 'L2', 'sequential', 'L2', 25),
      move('chg_l3_l1', 'Send to Bank', 'L3', 'L1', 'sequential', 'L1', 30)
    ]
  },
  {
    key: 'PATH_PROBLEM_L3',
    name: 'Problem Management – SunTec L3 Path',
    description: 'Problem-management path owned by SunTec for RCA and permanent correction.',
    levels: [level('L3', 'L3 · SunTec Product / Platform', 'suntec', false, 10, 'WF_PROBLEM_L3')],
    movementRules: []
  },
  {
    key: 'PATH_QUERY_L1',
    name: 'Query – Bank L1 Path',
    description: 'Simple query path for Bank L1 information and assistance requests.',
    levels: [level('L1', 'L1 · Bank', 'client', false, 10, 'WF_QUERY_L1')],
    movementRules: []
  }
];

function fieldsConfig(kind) {
  if (kind === 'query') return { severity: false, priority: false, product: true, module: true, region: false, environment: false };
  if (kind === 'incident') return { severity: true, priority: true, product: true, module: true, region: true, environment: true };
  return { severity: false, priority: true, product: true, module: true, region: true, environment: true };
}

async function upsertWorkflow(organizationId, def, apply) {
  const found = await Workflow.findOne({ organizationId, key: def.key });
  const desired = {
    organizationId,
    key: def.key,
    name: def.name,
    description: def.description,
    statuses: def.statuses,
    transitions: def.transitions,
    status: 'active'
  };
  if (!found) {
    console.log(`  + Workflow ${def.key} · ${def.name}`);
    if (!apply) return { _id: new mongoose.Types.ObjectId(), ...desired, _preview: true };
    return Workflow.create(desired);
  }
  const changed = found.name !== desired.name || found.description !== desired.description || found.status !== 'active' || !same(found.statuses, desired.statuses) || !same(found.transitions, desired.transitions);
  console.log(`  ${changed ? '~' : '='} Workflow ${def.key} · ${def.name}`);
  if (changed && apply) {
    found.name = desired.name;
    found.description = desired.description;
    found.statuses = desired.statuses;
    found.transitions = desired.transitions;
    found.status = 'active';
    await found.save();
  }
  return found;
}

async function upsertSupportPath(organizationId, def, workflowMap, apply) {
  const levels = def.levels.map((item) => {
    const workflow = workflowMap.get(item.workflowKey);
    if (!workflow) throw new Error(`Workflow ${item.workflowKey} is missing for support path ${def.key}.`);
    return {
      localId: item.localId,
      label: item.label,
      ownerSide: item.ownerSide,
      slaApplicable: item.slaApplicable,
      displayOrder: item.displayOrder,
      workflowId: workflow._id,
      workflowName: workflow.name
    };
  });
  const desired = {
    organizationId,
    key: def.key,
    name: def.name,
    description: def.description,
    levels,
    movementRules: def.movementRules,
    status: 'active'
  };
  const found = await SupportPath.findOne({ organizationId, key: def.key });
  if (!found) {
    console.log(`  + Support Path ${def.key} · ${def.name}`);
    if (!apply) return { _id: new mongoose.Types.ObjectId(), ...desired, _preview: true };
    return SupportPath.create(desired);
  }
  const changed = found.name !== desired.name || found.description !== desired.description || found.status !== 'active' || !same(found.levels, desired.levels) || !same(found.movementRules, desired.movementRules);
  console.log(`  ${changed ? '~' : '='} Support Path ${def.key} · ${def.name}`);
  if (changed && apply) {
    found.name = desired.name;
    found.description = desired.description;
    found.levels = desired.levels;
    found.movementRules = desired.movementRules;
    found.status = 'active';
    await found.save();
  }
  return found;
}

async function upsertTaxonomyNode({ organizationId, level, parentTypeId = null, name, key, description, icon = '◌', displayOrder = 100, apply }) {
  const query = { organizationId, level, parentTypeId, key };
  const found = await IssueType.findOne(query);
  const desired = { organizationId, level, parentTypeId, name, key, description, icon, displayOrder, status: 'active' };
  if (!found) {
    console.log(`  + Taxonomy L${level} ${key} · ${name}`);
    if (!apply) return { _id: new mongoose.Types.ObjectId(), ...desired, _preview: true, customFields: [], fieldsConfig: fieldsConfig(level === 1 ? 'default' : 'default') };
    return IssueType.create({ ...desired, ...(level > 1 ? { fieldsConfig: fieldsConfig('default') } : {}) });
  }
  const changed = found.name !== name || found.description !== description || found.icon !== icon || Number(found.displayOrder || 100) !== Number(displayOrder) || found.status !== 'active';
  console.log(`  ${changed ? '~' : '='} Taxonomy L${level} ${key} · ${name}`);
  if (changed && apply) {
    found.name = name;
    found.description = description;
    found.icon = icon;
    found.displayOrder = displayOrder;
    found.status = 'active';
    await found.save();
  }
  return found;
}

async function ensureRequestTaxonomy(organizationId, apply) {
  console.log('\nREQUEST TAXONOMY');
  const family = await upsertTaxonomyNode({ organizationId, level: 1, parentTypeId: null, ...REQUEST_TAXONOMY.family, apply });
  const issueTypes = new Map();
  const subtypes = new Map();

  for (const def of REQUEST_TAXONOMY.issueTypes) {
    const issueType = await upsertTaxonomyNode({ organizationId, level: 2, parentTypeId: family._id, name: def.name, key: def.key, description: def.description, displayOrder: def.displayOrder, apply });
    issueTypes.set(def.key, issueType);
    let order = 10;
    for (const [name, key, description] of def.subtypes) {
      const subtype = await upsertTaxonomyNode({ organizationId, level: 3, parentTypeId: issueType._id, name, key, description, displayOrder: order, apply });
      subtypes.set(`${def.key}:${key}`, subtype);
      order += 10;
    }
  }
  return { family, issueTypes, subtypes };
}

function mergeCustomFields(existingFields, desiredFields) {
  const desiredMap = new Map((desiredFields || []).map((item) => [String(item.fieldKey).toUpperCase(), item]));
  const output = [];
  const seen = new Set();
  for (const existing of existingFields || []) {
    const key = String(existing.fieldKey || '').toUpperCase();
    if (desiredMap.has(key)) {
      output.push(desiredMap.get(key));
      seen.add(key);
    } else {
      output.push(plain(existing));
    }
  }
  for (const desired of desiredFields || []) {
    const key = String(desired.fieldKey).toUpperCase();
    if (!seen.has(key) && !(existingFields || []).some((item) => String(item.fieldKey || '').toUpperCase() === key)) output.push(desired);
  }
  return output;
}

async function bindIssueType(node, { workflow, path, slaApplicable, config, customFields = [], formDefinitionKey = '' }, apply) {
  if (!node) throw new Error('Cannot bind a missing Issue Type node.');
  const desiredCustomFields = mergeCustomFields(node.customFields || [], customFields);
  const changed = String(node.workflowId || '') !== String(workflow?._id || '')
    || String(node.supportPathId || '') !== String(path?._id || '')
    || node.slaApplicable !== slaApplicable
    || !same(node.fieldsConfig || {}, config)
    || !same(node.customFields || [], desiredCustomFields)
    || String(node.formDefinitionKey || '') !== String(formDefinitionKey || '')
    || node.status !== 'active';
  console.log(`  ${changed ? '~' : '='} Bind L${node.level} ${node.key} -> ${workflow?.key || 'none'} / ${path?.key || 'none'} / SLA ${slaApplicable ? 'yes' : 'no'}`);
  if (changed && apply) {
    node.workflowId = workflow?._id || null;
    node.supportPathId = path?._id || null;
    node.slaApplicable = slaApplicable;
    node.fieldsConfig = config;
    node.customFields = desiredCustomFields;
    node.formDefinitionKey = String(formDefinitionKey || '').trim().toUpperCase();
    node.status = 'active';
    await node.save();
  }
}

async function configureTaxonomyBindings(taxonomy, workflowMap, pathMap, apply) {
  console.log('\nISSUE TYPE BEHAVIOUR BINDINGS');

  const incident = taxonomy.issueTypes.get('INCIDENT');
  await bindIssueType(incident, {
    workflow: workflowMap.get('WF_INC_APP_L1'),
    path: pathMap.get('PATH_INC_APP_PARALLEL'),
    slaApplicable: true,
    config: fieldsConfig('incident')
  }, apply);

  const incidentBindings = {
    APPLICATION: ['WF_INC_APP_L1', 'PATH_INC_APP_PARALLEL', 'SAAS_INCIDENT_APPLICATION'],
    SECURITY: ['WF_INC_SEC_L2', 'PATH_INC_SEC_STANDARD', 'SAAS_INCIDENT_SECURITY'],
    OPERATIONAL: ['WF_INC_OPS_L2', 'PATH_INC_OPS_STANDARD', 'SAAS_INCIDENT_OPERATIONAL'],
    INFRASTRUCTURE: ['WF_INC_INF_L2', 'PATH_INC_INF_STANDARD', 'SAAS_INCIDENT_INFRASTRUCTURE']
  };
  for (const [subtypeKey, [workflowKey, pathKey, formDefinitionKey]] of Object.entries(incidentBindings)) {
    const node = taxonomy.subtypes.get(`INCIDENT:${subtypeKey}`);
    await bindIssueType(node, {
      workflow: workflowMap.get(workflowKey),
      path: pathMap.get(pathKey),
      slaApplicable: true,
      config: fieldsConfig('incident'),
      customFields: INCIDENT_FIELDS[subtypeKey] || [],
      formDefinitionKey
    }, apply);
  }

  const generic = [
    ['SERVICE_REQUEST', 'WF_SR_L1', 'PATH_SR_STANDARD', 'default'],
    ['MAINTENANCE_REQUEST', 'WF_MAINT_L2', 'PATH_MAINT_STANDARD', 'default'],
    ['PROBLEM', 'WF_PROBLEM_L3', 'PATH_PROBLEM_L3', 'default'],
    ['CHANGE_REQUEST', 'WF_CHANGE_L1', 'PATH_CHANGE_STANDARD', 'default'],
    ['QUERY', 'WF_QUERY_L1', 'PATH_QUERY_L1', 'query']
  ];

  for (const [issueKey, workflowKey, pathKey, configKind] of generic) {
    const parent = taxonomy.issueTypes.get(issueKey);
    await bindIssueType(parent, {
      workflow: workflowMap.get(workflowKey),
      path: pathMap.get(pathKey),
      slaApplicable: false,
      config: fieldsConfig(configKind)
    }, apply);

    for (const [mapKey, node] of taxonomy.subtypes.entries()) {
      if (!mapKey.startsWith(`${issueKey}:`)) continue;
      await bindIssueType(node, {
        workflow: workflowMap.get(workflowKey),
        path: pathMap.get(pathKey),
        slaApplicable: false,
        config: fieldsConfig(configKind)
      }, apply);
    }
  }
}

async function updateSlaApplicability(organizationId, apply) {
  const environments = await Environment.find({ organizationId, code: { $in: ['PROD', 'DR'] }, status: 'active' });
  const byCode = new Map(environments.map((item) => [item.code, item]));
  if (!byCode.get('PROD') || !byCode.get('DR')) throw new Error('PROD and DR environments are required. Run the master-data seed first.');
  const environmentIds = [byCode.get('PROD')._id, byCode.get('DR')._id];

  console.log('\nSLA APPLICABILITY');
  const policies = new Map();
  for (const [plan, key] of Object.entries(SLA_KEYS)) {
    const policy = await SlaPolicy.findOne({ organizationId, key });
    if (!policy) throw new Error(`SLA policy ${key} is missing. Run seed-uat-users-slas.mjs first.`);
    const desiredApplicability = {
      applyOnlyWhenSeveritySelected: true,
      applicableEnvironmentIds: environmentIds,
      applicableIssueLevelCodes: ['L2', 'L3']
    };
    const desiredDescription = `${policy.name} for SLA-applicable SaaS incidents in Production/DR; SLA starts after severity selection and is inactive at L1.`;
    const changed = !same(policy.applicability, desiredApplicability) || policy.description !== desiredDescription || policy.status !== 'active';
    console.log(`  ${changed ? '~' : '='} ${key}: PROD/DR · L2/L3 · severity-selected`);
    if (changed && apply) {
      policy.applicability = desiredApplicability;
      policy.description = desiredDescription;
      policy.status = 'active';
      await policy.save();
    }
    policies.set(plan, policy);
  }
  return policies;
}

async function findClients(organizationId) {
  const all = await Client.find({ organizationId });
  const byCode = new Map(all.map((item) => [String(item.shortCode || '').toUpperCase(), item]));
  for (const code of [CLIENTS.standard.code, ...CLIENTS.standard.children, CLIENTS.danske.code, ...CLIENTS.danske.children]) {
    if (!byCode.has(code)) throw new Error(`Client ${code} is missing. Run seed-uat-master-data.mjs first.`);
  }
  return byCode;
}

function upsertFamilyAssignment(existingAssignments, familyId, policyId) {
  const output = (existingAssignments || []).map((item) => plain(item));
  const index = output.findIndex((item) => String(item.level1TypeId || '') === String(familyId));
  const next = {
    localId: `family_${String(familyId)}`.slice(0, 80),
    level1TypeId: familyId,
    slaPolicyId: policyId,
    inheritToChildren: true,
    isActive: true
  };
  if (index >= 0) output[index] = next;
  else output.push(next);
  return output;
}

async function assignPlanToRoot({ root, children, family, planName, policies, apply }) {
  const policy = planName === 'none' ? null : policies.get(planName);
  if (planName !== 'none' && !policy) throw new Error(`Policy for ${planName} was not resolved.`);

  const nextFamilies = uniqueObjectIds([...(root.enabledFamilyIds || []), family._id]);
  const nextAssignments = policy
    ? upsertFamilyAssignment(root.familySlaAssignments || [], family._id, policy._id)
    : (root.familySlaAssignments || []).map((item) => plain(item)).filter((item) => String(item.level1TypeId || '') !== String(family._id));

  const changedRoot = root.issueTypeMode !== 'custom'
    || root.slaMode !== 'custom'
    || String(root.defaultSlaPolicyId || '') !== String(policy?._id || '')
    || !same(root.enabledFamilyIds || [], nextFamilies)
    || !same(root.familySlaAssignments || [], nextAssignments);

  console.log(`  ${changedRoot ? '~' : '='} ${root.shortCode} · ${root.name} -> ${policy ? policy.name : 'No default SLA'} · Request Family enabled`);
  if (changedRoot && apply) {
    root.issueTypeMode = 'custom';
    root.enabledFamilyIds = nextFamilies;
    root.slaMode = 'custom';
    root.defaultSlaPolicyId = policy?._id || null;
    root.familySlaAssignments = nextAssignments;
    await root.save();
  }

  for (const child of children) {
    const changedChild = child.issueTypeMode !== 'inherit'
      || child.slaMode !== 'inherit'
      || (child.enabledFamilyIds || []).length > 0
      || Boolean(child.defaultSlaPolicyId)
      || (child.familySlaAssignments || []).length > 0;
    console.log(`  ${changedChild ? '~' : '='} ${child.shortCode} · ${child.name} -> inherit from ${root.shortCode}`);
    if (changedChild && apply) {
      child.issueTypeMode = 'inherit';
      child.enabledFamilyIds = [];
      child.slaMode = 'inherit';
      child.defaultSlaPolicyId = null;
      child.familySlaAssignments = [];
      await child.save();
    }
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) return printHelp();

  await connectDatabase();
  const organization = await Organization.findOne({ workspaceSlug: options.workspace });
  if (!organization) throw new Error(`Workspace "${options.workspace}" was not found.`);

  console.log('Service Manager v23.1.4 · UAT SUPPORT MODEL SEED');
  console.log(`Mode          : ${options.apply ? 'APPLY' : 'DRY RUN'}`);
  console.log(`Workspace     : /${organization.workspaceSlug} · ${organization.name}`);
  console.log(`Standard Bank : ${options.standardPlan.toUpperCase()}`);
  console.log(`Danske Bank   : ${options.danskePlan.toUpperCase()}`);

  const taxonomy = await ensureRequestTaxonomy(organization._id, options.apply);

  console.log('\nWORKFLOWS');
  const workflowMap = new Map();
  for (const def of WORKFLOW_DEFS) {
    const workflow = await upsertWorkflow(organization._id, def, options.apply);
    workflowMap.set(def.key, workflow);
  }

  console.log('\nSUPPORT PATHS');
  const pathMap = new Map();
  for (const def of SUPPORT_PATH_DEFS) {
    const path = await upsertSupportPath(organization._id, def, workflowMap, options.apply);
    pathMap.set(def.key, path);
  }

  await configureTaxonomyBindings(taxonomy, workflowMap, pathMap, options.apply);
  const policies = await updateSlaApplicability(organization._id, options.apply);

  console.log('\nCLIENT SUPPORT PLANS');
  const clientMap = await findClients(organization._id);
  await assignPlanToRoot({
    root: clientMap.get(CLIENTS.standard.code),
    children: CLIENTS.standard.children.map((code) => clientMap.get(code)),
    family: taxonomy.family,
    planName: options.standardPlan,
    policies,
    apply: options.apply
  });
  await assignPlanToRoot({
    root: clientMap.get(CLIENTS.danske.code),
    children: CLIENTS.danske.children.map((code) => clientMap.get(code)),
    family: taxonomy.family,
    planName: options.danskePlan,
    policies,
    apply: options.apply
  });

  console.log('\nCONFIGURATION SUMMARY');
  console.log('  Support ownership : Bank L1 -> Partner L2 -> SunTec L3');
  console.log('  Incident SLA      : L1 no · L2 yes · L3 yes; severity-selected; PROD/DR');
  console.log('  Application path  : L1 escalation starts L2 + L3 in parallel (L2 primary)');
  console.log('  Security path     : L2 Partner -> L3 SunTec');
  console.log('  Operational path  : L2 Partner -> L3 SunTec');
  console.log('  Infrastructure    : L2 Partner -> L3 SunTec; L3 includes Vendor Support state');
  console.log('  Workflow additions: Under Monitoring · On Hold · Bank to Verify (Application) · two-stage closure · RCA tasks');
  console.log('  Other request types: generic Service Request / Maintenance / Change / Problem / Query paths seeded');

  if (!options.apply) {
    console.log('\nDRY RUN ONLY — no records were changed.');
    console.log('After review, rerun the same command with --apply.');
  } else {
    console.log('\nApply complete. The UAT support model is seeded and safe to rerun.');
  }
}

main()
  .catch((error) => {
    console.error(`\nFAILED: ${error.message || error}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await disconnectDatabase().catch(() => {});
  });
