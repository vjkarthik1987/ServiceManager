import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import mongoose from 'mongoose';

import { connectDatabase, disconnectDatabase } from '../services/organization-service/src/db.js';
import { Organization } from '../services/organization-service/src/models/Organization.js';
import { Severity } from '../services/organization-service/src/models/Severity.js';
import { Priority } from '../services/organization-service/src/models/Priority.js';
import { Environment } from '../services/organization-service/src/models/Environment.js';
import { IssueType } from '../services/organization-service/src/models/IssueType.js';
import { Workflow } from '../services/organization-service/src/models/Workflow.js';
import { SupportPath } from '../services/organization-service/src/models/SupportPath.js';
import { SlaPolicy } from '../services/organization-service/src/models/SlaPolicy.js';
import { Client } from '../services/organization-service/src/models/Client.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

const SOURCE_NOTE = 'Provisioned for the SunTec Service Desk four-family model: Ticket (regular/product support), SaaS Incident, SaaS Maintenance Request, and SaaS Service Request. Ticket support levels and SLA templates are based on SunTec Support Models (Feb 2021); SaaS process configuration is based on Xelerate SaaS Incident V1.3, Maintenance Request V1.4, and Service Request V1.6.';

function parseArgs(argv) {
  const options = {
    apply: false,
    organization: 'suntecsds',
    client: 'STDBNK',
    saasClient: 'SAASBK',
    assignSla: 'none',
    parallelMode: 's1-s2-prod-dr',
    children: 'inherit',
    validateOnly: false,
    help: false
  };
  for (const arg of argv) {
    if (arg === '--apply') options.apply = true;
    else if (arg === '--dry-run') options.apply = false;
    else if (arg === '--validate-only') options.validateOnly = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg.startsWith('--organization=')) options.organization = arg.slice('--organization='.length).trim();
    else if (arg.startsWith('--client=')) options.client = arg.slice('--client='.length).trim();
    else if (arg.startsWith('--saas-client=')) options.saasClient = arg.slice('--saas-client='.length).trim();
    else if (arg.startsWith('--assign-sla=')) options.assignSla = arg.slice('--assign-sla='.length).trim().toLowerCase();
    else if (arg.startsWith('--parallel-mode=')) options.parallelMode = arg.slice('--parallel-mode='.length).trim().toLowerCase();
    else if (arg.startsWith('--children=')) options.children = arg.slice('--children='.length).trim().toLowerCase();
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!['none', 'sample', 'silver', 'gold', 'platinum'].includes(options.assignSla)) {
    throw new Error('--assign-sla must be one of: none, sample, silver, gold, platinum');
  }
  if (!['s1-s2-prod-dr', 'all-l2'].includes(options.parallelMode)) {
    throw new Error('--parallel-mode must be one of: s1-s2-prod-dr, all-l2');
  }
  if (!['inherit', 'preserve'].includes(options.children)) {
    throw new Error('--children must be one of: inherit, preserve');
  }
  return options;
}

function printHelp() {
  console.log(`\nSunTec Service Desk four-family provisioner\n\nUsage:\n  npm run provision:suntecsds-service-model\n  npm run provision:suntecsds-service-model -- --apply\n  npm run provision:suntecsds-service-model -- --organization=suntecsds --client=STDBNK --saas-client=SAASBK --apply\n\nDefaults:\n  organization   suntecsds\n  product client STDBNK (Ticket only)\n  SaaS client    SAASBK (Incident + Maintenance Request + Service Request)\n  assign SLA     none\n  parallel mode  s1-s2-prod-dr\n  children       inherit\n\nOptions:\n  --dry-run                         Preview only (default).\n  --validate-only                    Validate the provisioning catalogue without MongoDB.\n  --apply                           Write changes to MongoDB after validation and backup.\n  --organization=<slug|code|name>  Target organization.\n  --client=<code|name|id>          Product-support client; defaults to STDBNK.\n  --saas-client=<code|name|id>     SaaS root client; defaults to SAASBK and is created if absent.\n  --assign-sla=<value>              none|sample|silver|gold|platinum (product client default policy only).\n  --parallel-mode=<value>           s1-s2-prod-dr|all-l2 for SaaS Application Incident.\n  --children=<value>                inherit|preserve.\n  --help                            Show this help.\n\nThe script is idempotent and merge-safe. It makes client-to-Issue-Family availability authoritative, removes stale provisioner-owned routing rules that no longer belong to a client's enabled families, and preserves unrelated custom records.\n`);
}

function canonical(value) {
  return String(value || '')
    .normalize('NFKC')
    .replace(/[–—−]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function makeKey(value, max = 80) {
  const key = String(value || '')
    .trim()
    .toUpperCase()
    .replace(/&/g, ' AND ')
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, max);
  return key || 'ITEM';
}

function plain(value) {
  if (value === null || value === undefined) return value;
  if (value?.toObject) return value.toObject({ depopulate: true });
  return JSON.parse(JSON.stringify(value));
}

function objectId() {
  return new mongoose.Types.ObjectId();
}

function isSame(a, b) {
  return JSON.stringify(plain(a)) === JSON.stringify(plain(b));
}

const changes = [];
function record(action, area, key, detail = '') {
  changes.push({ action, area, key, detail });
}

function changeMarker(action) {
  if (action === 'create') return '+';
  if (action === 'update') return '~';
  if (action === 'unchanged') return '=';
  if (action === 'warning') return '!';
  return '·';
}

function field(fieldKey, label, fieldType = 'short_text', required = false, helpText = '', options = [], displayOrder = 100) {
  return {
    fieldKey: makeKey(fieldKey, 60),
    label,
    fieldType,
    required,
    helpText: String(helpText || '').slice(0, 260),
    optionsText: Array.isArray(options) ? options.join('\n').slice(0, 1200) : String(options || '').slice(0, 1200),
    displayOrder,
    status: 'active'
  };
}

function task(localId, title, description, ownerSide, queue, isBlocking = true, visibility = 'internal_only', displayOrder = 10) {
  return { localId, title, description, ownerSide, queue, isBlocking, visibility, displayOrder };
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

function commonPauseStatuses(prefix, ownerSide, queue, visibility, baseOrder = 800) {
  return [
    wfStatus('on_hold', 'On Hold', 'hold', 'On Hold', [
      task(`${prefix}_hold_reason`, 'Record hold reason', 'Record the dependency, accountable owner, and expected resume date.', ownerSide, queue, false, visibility, 10)
    ], baseOrder),
    wfStatus('under_monitoring', 'Under Monitoring', 'waiting', 'Under Monitoring', [
      task(`${prefix}_monitor`, 'Monitor service condition', 'Monitor the affected service for recurrence and record the observation before resuming work.', ownerSide, queue, true, visibility, 10)
    ], baseOrder + 10),
    wfStatus('deferred', 'Deferred', 'hold', 'Deferred', [
      task(`${prefix}_defer`, 'Record deferral details', 'Record why the incident is deferred, the dependency, review date, and accountable owner.', ownerSide, queue, false, visibility, 10)
    ], baseOrder + 20)
  ];
}

function incidentClosureStatuses(prefix, ownerSide, queue, finalOwnerSide = ownerSide, finalQueue = queue, baseOrder = 900) {
  return [
    wfStatus('resolved', 'Resolved', 'resolved', 'Resolved', [
      task(`${prefix}_resolution_summary`, 'Record final resolution', 'Document the final resolution, affected environment, evidence, and service restoration time.', ownerSide, queue, true, 'client_visible', 10),
      task(`${prefix}_rca`, 'Complete RCA', 'Record RCA category, root cause, corrective action, preventive action, and RCA status for customer visibility.', ownerSide, queue, true, 'client_visible', 20),
      task(`${prefix}_closure_ready`, 'Confirm closure readiness', 'Confirm verification, evidence, RCA, and all blocking work are complete.', ownerSide, queue, true, 'client_visible', 30)
    ], baseOrder),
    wfStatus('pending_close', 'Pending Closure Approval', 'waiting', 'Closure Approval Pending', [
      task(`${prefix}_closure_approval`, 'Review and approve closure', 'SunTec Global Support reviews resolution, production verification, RCA, and open actions before approving closure.', 'suntec', 'SunTec Global Support', true, 'internal_only', 10)
    ], baseOrder + 10),
    wfStatus('approved_close', 'Approved to Close', 'normal', 'Approved for Closure', [
      task(`${prefix}_final_close`, 'Complete final closure', 'Record the final closure comment after closure approval.', finalOwnerSide, finalQueue, true, 'client_visible', 10)
    ], baseOrder + 20),
    wfStatus('closed', 'Closed', 'final', 'Closed', [], baseOrder + 30)
  ];
}

function genericIncidentTasks(prefix, ownerSide, queue, visibility = 'partner_visible') {
  return {
    assigned: [
      task(`${prefix}_accept`, 'Accept ownership', 'Confirm ownership and identify the engineer or team responsible for the incident.', ownerSide, queue, true, visibility, 10),
      task(`${prefix}_validate`, 'Validate incident context', 'Validate subtype, environment, severity, description, impact, evidence links, and handover details.', ownerSide, queue, true, 'client_visible', 20)
    ],
    analysis: [
      task(`${prefix}_analyse`, 'Perform incident analysis', 'Investigate the incident, reproduce where possible, and identify the likely cause and resolution path.', ownerSide, queue, true, visibility, 10),
      task(`${prefix}_findings`, 'Record analysis findings', 'Record checks performed, findings, evidence, dependencies, and current customer impact.', ownerSide, queue, true, 'client_visible', 20),
      task(`${prefix}_decision`, 'Decide resolution or escalation', 'Confirm whether the incident can be resolved at this level or requires the next support level.', ownerSide, queue, true, visibility, 30)
    ],
    resolution: [
      task(`${prefix}_resolution`, 'Apply resolution or workaround', 'Apply the approved configuration, data, restart, rollback, hardening, or other restoration action.', ownerSide, queue, true, visibility, 10),
      task(`${prefix}_resolution_evidence`, 'Record resolution evidence', 'Record the action, result, evidence, remaining risk, and next verification step.', ownerSide, queue, true, 'client_visible', 20)
    ]
  };
}

function environmentVerificationStatus(prefix, localId, name, ownerSide, queue, order, visibility = 'partner_visible', approvalLabel = 'Confirm environment approval') {
  return wfStatus(localId, name, 'normal', name, [
    task(`${prefix}_${localId}_approval`, approvalLabel, `Confirm the required approval before work proceeds in ${name.replace(/^Verify in /, '').replace(/^Deploy to /, '')}.`, ownerSide, queue, true, visibility, 10),
    task(`${prefix}_${localId}_execute`, `Complete ${name.toLowerCase()}`, `Apply or verify the approved change for ${name.replace(/^Verify in /, '').replace(/^Deploy to /, '')} and record the result and evidence.`, ownerSide, queue, true, visibility === 'internal_only' ? 'internal_only' : 'client_visible', 20)
  ], order);
}

const RCA_OPTIONS = [
  'Improper Requirement Analysis', 'Improper impact analysis', 'Improper Documentation', 'Improper Version Management',
  'Not Following Standard Operating Procedure', 'Improper Design', 'Insufficient Test Coverage', 'Knowledge Gap',
  'Improper Planning', 'Release Packing', 'Release Deployment', 'Product Bugs', 'Data Issue', 'Environmental Issues',
  'Mistake/omission in coding', 'Improper/Incomplete Functional Design', 'Improper/Incomplete Technical Design'
];

const COMMON_INCIDENT_FIELDS = [
  field('RELEASE_ID', 'Release ID', 'short_text', false, 'Issue release ID, when a release is required.', [], 60),
  field('RELEASE_TYPE', 'Release Type', 'dropdown', false, 'Set by support when a release is required.', ['Emergency', 'Normal'], 70),
  field('S3_BUCKET_URL', 'S3 Bucket URL', 'url', false, 'Use S3 links for screenshots, logs, and evidence where data-residency rules prohibit attachments.', [], 80),
  field('TEST_CASE_LINK', 'Test Case Link', 'url', false, 'Internal repository link for relevant test cases.', [], 90),
  field('REMARKS', 'Remarks', 'long_text', false, 'Additional incident notes.', [], 100),
  field('RCA_CATEGORY', 'RCA Category', 'dropdown', false, 'RCA details become customer-visible once completed.', RCA_OPTIONS, 200),
  field('ROOT_CAUSE', 'Root Cause', 'long_text', false, 'Root cause analysis.', [], 210),
  field('CORRECTIVE_ACTION', 'Corrective Action', 'long_text', false, 'Corrective action taken.', [], 220),
  field('PREVENTIVE_ACTION', 'Preventive Action', 'long_text', false, 'Preventive action planned or completed.', [], 230),
  field('RCA_STATUS', 'RCA Status', 'dropdown', false, '', ['Open', 'In Progress', 'Closed'], 240),
  field('APPROVER', 'Approver', 'short_text', false, 'Approver for production movement or closure where applicable.', [], 250),
  field('EXCEPTION_APPROVER', 'Exception Approver', 'short_text', false, 'Alternative approver when the normal approver is unavailable.', [], 260)
];

const CONFIG = {
  severities: [
    { code: 'S1', name: 'Critical', description: 'The system cannot be used; critical impact on production and an immediate solution is required.', marker: 'Critical', displayOrder: 10 },
    { code: 'S2', name: 'Serious', description: 'The software is operational under extreme restrictions; a workaround may exist but correction is required as soon as possible.', marker: 'High', displayOrder: 20 },
    { code: 'S3', name: 'Moderate', description: 'The software is operational under restrictions; the problem can be avoided or ignored but causes recurring problems.', marker: 'Medium', displayOrder: 30 },
    { code: 'S4', name: 'Minor', description: 'Incorrect behaviour with no significant impact on operations.', marker: 'Low', displayOrder: 40 }
  ],
  priorities: [
    { code: 'P1', name: 'Critical', description: 'Critical request priority.', marker: 'Critical', displayOrder: 10 },
    { code: 'P2', name: 'High', description: 'High request priority.', marker: 'High', displayOrder: 20 },
    { code: 'P3', name: 'Medium', description: 'Medium request priority.', marker: 'Medium', displayOrder: 30 },
    { code: 'P4', name: 'Low', description: 'Low request priority.', marker: 'Low', displayOrder: 40 }
  ],
  environments: [
    { code: 'BUILD', aliases: ['BLD'], name: 'Build', description: 'Build and early validation environment.', environmentType: 'non_production', slaApplicableByDefault: false, displayOrder: 10 },
    { code: 'SIT', aliases: [], name: 'SIT', description: 'System Integration Testing environment.', environmentType: 'non_production', slaApplicableByDefault: false, displayOrder: 20 },
    { code: 'QUALITY', aliases: ['QA'], name: 'Quality', description: 'Quality assurance environment.', environmentType: 'non_production', slaApplicableByDefault: false, displayOrder: 30 },
    { code: 'STAGE', aliases: ['STG'], name: 'Stage', description: 'Stage validation environment.', environmentType: 'non_production', slaApplicableByDefault: false, displayOrder: 40 },
    { code: 'PREPROD', aliases: ['PREPRODUCTION', 'PRE_PROD'], name: 'Preproduction', description: 'Production-like preproduction environment.', environmentType: 'production_like', slaApplicableByDefault: false, displayOrder: 50 },
    { code: 'PROD', aliases: ['PRODUCTION'], name: 'Production', description: 'Live production environment.', environmentType: 'production', slaApplicableByDefault: true, displayOrder: 60 },
    { code: 'DR', aliases: [], name: 'DR', description: 'Disaster recovery production-grade environment.', environmentType: 'dr', slaApplicableByDefault: true, displayOrder: 70 }
  ]
};

function incidentBaseStatuses({ prefix, ownerSide, queue, visibility, includeDevelopment = false, includeVendor = false, includeBankVerify = false, l1 = false, security = false }) {
  const tasks = genericIncidentTasks(prefix, ownerSide, queue, visibility);
  const statuses = [
    wfStatus('new', 'New', 'start', 'New', [], 10),
    wfStatus('assigned', 'Assigned', 'normal', ownerSide === 'client' ? 'Under Review' : 'Assigned', tasks.assigned, 20),
    wfStatus('analysis', 'Analysis', 'normal', 'Under Analysis', [
      ...tasks.analysis,
      ...(security ? [task(`${prefix}_security_notify`, 'Notify customer of security incident', 'Notify the customer about the confirmed security incident and the expected resolution timeframe based on severity.', ownerSide, queue, true, 'client_visible', 40)] : [])
    ], 30),
    wfStatus('resolution', 'Resolution', 'normal', 'Resolution in Progress', tasks.resolution, 40)
  ];

  if (includeVendor) {
    statuses.push(wfStatus('vendor_support', 'Vendor Support', 'waiting', 'Vendor Support', [
      task(`${prefix}_vendor_raise`, 'Raise vendor support case', 'Raise the external vendor case and record the vendor case ID, priority, evidence, and next commitment.', 'internal', 'Vendor Coordination', true, 'internal_only', 10),
      task(`${prefix}_vendor_response`, 'Record vendor response', 'Record vendor findings, workaround, recommendation, and the next action.', 'internal', 'Vendor Coordination', true, 'partner_visible', 20)
    ], 45));
  }

  if (includeDevelopment) {
    statuses.push(
      wfStatus('development', 'Development', 'normal', 'Engineering Fix', [
        task(`${prefix}_dev_fix`, 'Implement fix', 'Implement the required code, product, platform, or automation fix and link the internal engineering work item.', 'suntec', 'Product / Platform Engineering', true, 'internal_only', 10),
        task(`${prefix}_dev_review`, 'Complete peer review', 'Complete peer review and address all observations before release preparation.', 'suntec', 'Product / Platform Engineering', true, 'internal_only', 20),
        task(`${prefix}_dev_test`, 'Complete internal testing', 'Test the fix in the internal environment and record results before release.', 'suntec', 'Product / Platform Engineering', true, 'internal_only', 30)
      ], 50),
      wfStatus('release', 'Release', 'normal', 'Release Preparation', [
        task(`${prefix}_release_prepare`, 'Prepare approved release', 'Record release ID, release type, impacted areas, test evidence, deployment sequence, and rollback plan.', 'suntec', 'Release Management', true, 'partner_visible', 10),
        task(`${prefix}_release_publish`, 'Publish release to client handoff', 'Upload the approved release to the agreed client repository/FTP and hand over deployment instructions to Partner.', 'suntec', 'Release Management', true, 'partner_visible', 20)
      ], 60)
    );
  }

  if (l1) {
    statuses.push(
      environmentVerificationStatus(prefix, 'verify_preprod', 'Verify in Preproduction', ownerSide, queue, 100, 'client_visible', 'Confirm verification prerequisites'),
      environmentVerificationStatus(prefix, 'deploy_prod_dr', 'Deploy to Production/DR', ownerSide, queue, 110, 'client_visible', 'Confirm production/DR approval'),
      wfStatus('verification_complete', 'Verification Complete', 'normal', 'Verification Complete', [
        task(`${prefix}_verify_complete`, 'Confirm verification complete', 'Confirm the issue is resolved in the environment where it was raised and record verification evidence.', ownerSide, queue, true, 'client_visible', 10)
      ], 120)
    );
  } else {
    statuses.push(
      environmentVerificationStatus(prefix, 'verify_build', 'Verify in Build', ownerSide, queue, 100, visibility),
      environmentVerificationStatus(prefix, 'verify_quality', 'Verify in Quality', ownerSide, queue, 110, visibility),
      environmentVerificationStatus(prefix, 'verify_stage', 'Verify in Stage', ownerSide, queue, 120, visibility),
      environmentVerificationStatus(prefix, 'verify_preprod', 'Verify in Preproduction', ownerSide, queue, 130, visibility),
      wfStatus('deploy_prod_dr', 'Deploy to Production/DR', 'normal', 'Deploy to Production/DR', [
        task(`${prefix}_prod_approval`, 'Confirm production/DR approval and notification', 'Confirm required client and SunTec approvals/notifications before Production or DR deployment.', ownerSide, queue, true, 'client_visible', 10),
        task(`${prefix}_prod_deploy`, 'Deploy resolution to Production/DR', 'Apply the approved fix or resolution to Production/DR and record implementation evidence.', ownerSide, queue, true, visibility, 20),
        task(`${prefix}_prod_verify`, 'Verify Production/DR stability', 'Confirm the service is up and running, verify the incident is resolved, and record customer-safe evidence.', ownerSide, queue, true, 'client_visible', 30)
      ], 140)
    );
    if (includeBankVerify) {
      statuses.push(wfStatus('bank_verify', 'Bank to Verify', 'waiting', 'Awaiting Bank Verification', [
        task(`${prefix}_bank_instructions`, 'Provide Bank verification instructions', 'Clearly explain what the Bank must verify, the environment, expected result, and any evidence required.', ownerSide, queue, false, 'client_visible', 10),
        task(`${prefix}_bank_result`, 'Record Bank verification outcome', 'Capture the Bank verification outcome, comments, and evidence before returning the incident to support.', 'client', 'Bank Verification', true, 'client_visible', 20)
      ], 150));
    }
    statuses.push(wfStatus('verification_complete', 'Verification Complete', 'normal', 'Verification Complete', [
      task(`${prefix}_verification_complete`, 'Confirm verification complete', 'Confirm successful verification in the required environment and record the final result.', ownerSide, queue, true, 'client_visible', 10)
    ], includeBankVerify ? 160 : 150));
  }

  statuses.push(...commonPauseStatuses(prefix, ownerSide, queue, visibility, 800));
  statuses.push(
    wfStatus('duplicate', 'Duplicate', 'final', 'Duplicate', [], 840),
    wfStatus('not_issue', 'Not an Issue', 'final', 'Not an Issue', [], 850),
    wfStatus('cancelled', 'Cancelled', 'cancelled', 'Cancelled', [], 860)
  );
  statuses.push(...incidentClosureStatuses(prefix, ownerSide, queue, ownerSide, queue, 900));
  return statuses;
}

function addPauseTransitions(transitions, workingStates = ['analysis', 'resolution']) {
  for (const from of workingStates) {
    transitions.push(tr(from, 'on_hold'), tr(from, 'under_monitoring'), tr(from, 'deferred'));
  }
  for (const paused of ['on_hold', 'under_monitoring', 'deferred']) {
    for (const to of workingStates) transitions.push(tr(paused, to));
  }
}

function addEnvironmentFlowTransitions(transitions, startId, includeBankVerify = false, l1 = false) {
  const envs = l1
    ? ['verify_preprod', 'deploy_prod_dr', 'verification_complete']
    : ['verify_build', 'verify_quality', 'verify_stage', 'verify_preprod', 'deploy_prod_dr', ...(includeBankVerify ? ['bank_verify'] : []), 'verification_complete'];

  // Allow normal sequence and approved skipping to later environments.
  for (let i = 0; i < envs.length; i += 1) {
    transitions.push(tr(i === 0 ? startId : envs[i - 1], envs[i]));
    if (i > 0) transitions.push(tr(startId, envs[i]));
  }
  for (const env of envs.filter((id) => id !== 'verification_complete')) {
    transitions.push(tr(env, 'analysis'));
  }
  if (includeBankVerify) {
    transitions.push(tr('bank_verify', 'resolution'));
  }
  transitions.push(tr('verification_complete', 'resolved'));
}

function buildIncidentWorkflow({ key, name, description, prefix, ownerSide, queue, visibility, level, includeDevelopment = false, includeVendor = false, includeBankVerify = false, security = false }) {
  const l1 = level === 'L1';
  const statuses = incidentBaseStatuses({ prefix, ownerSide, queue, visibility, includeDevelopment, includeVendor, includeBankVerify, l1, security });
  const transitions = [tr('new', 'assigned'), tr('assigned', 'analysis'), tr('analysis', 'resolution'), tr('analysis', 'duplicate'), tr('analysis', 'not_issue'), tr('analysis', 'cancelled')];
  addPauseTransitions(transitions, ['analysis', 'resolution']);

  if (includeVendor) {
    transitions.push(tr('analysis', 'vendor_support'), tr('resolution', 'vendor_support'), tr('vendor_support', 'analysis'), tr('vendor_support', 'resolution'));
  }

  if (includeDevelopment) {
    transitions.push(tr('resolution', 'development'), tr('development', 'release'));
    addEnvironmentFlowTransitions(transitions, 'release', includeBankVerify, false);
    transitions.push(tr('resolution', 'resolved'));
  } else {
    addEnvironmentFlowTransitions(transitions, 'resolution', includeBankVerify, l1);
    transitions.push(tr('resolution', 'resolved'));
  }

  transitions.push(tr('resolved', 'pending_close'), tr('pending_close', 'approved_close'), tr('pending_close', 'analysis'), tr('approved_close', 'closed'));
  return { key, name, description, statuses, transitions, sourceLevel: level };
}


function ticketIncidentWorkflow({ key, name, description, ownerSide, queue, prefix, level, includeDevelopment = false }) {
  const visibility = ownerSide === 'suntec' ? 'internal_only' : 'client_visible';
  const statuses = [
    wfStatus('new', 'New', 'start', 'New', [], 10),
    wfStatus('assigned', 'Assigned', 'normal', 'Assigned', [
      task(`${prefix}_accept`, 'Accept ticket ownership', 'Confirm ownership and that the ticket is at the correct support level.', ownerSide, queue, true, visibility, 10),
      task(`${prefix}_validate`, 'Validate incident context', 'Validate impact, severity, product/module, environment, description, and available evidence.', ownerSide, queue, true, 'client_visible', 20)
    ], 20),
    wfStatus('analysis', 'Analysis', 'normal', 'Under Analysis', [
      task(`${prefix}_analyse`, 'Perform incident analysis', 'Investigate the issue, record checks performed, and identify the likely resolution path.', ownerSide, queue, true, visibility, 10),
      task(`${prefix}_findings`, 'Record analysis findings', 'Record findings, evidence, workaround information, and whether escalation is required.', ownerSide, queue, true, 'client_visible', 20)
    ], 30),
    wfStatus('need_info', 'Need Information', 'waiting', 'More Information Required', [
      task(`${prefix}_need_info`, 'Request missing information', 'Record the additional information required to continue investigation.', ownerSide, queue, false, 'client_visible', 10)
    ], 40),
    wfStatus('on_hold', 'On Hold', 'hold', 'On Hold', [], 50),
    wfStatus('resolution', 'Resolution', 'normal', 'Resolution in Progress', [
      task(`${prefix}_resolve`, 'Apply or provide resolution', 'Apply the supported correction/workaround or provide the resolution steps.', ownerSide, queue, true, visibility, 10)
    ], 60)
  ];
  if (includeDevelopment) {
    statuses.push(
      wfStatus('development', 'Development / Fix', 'normal', 'Product Fix in Progress', [
        task(`${prefix}_develop`, 'Develop product fix', 'Implement the required product/code fix and complete internal review and testing.', 'suntec', 'SunTec Product Engineering', true, 'internal_only', 10)
      ], 70),
      wfStatus('release', 'Release Prepared', 'normal', 'Release Prepared', [
        task(`${prefix}_release`, 'Prepare fix release', 'Prepare the correction release, release notes, deployment instructions, and test evidence for L2.', 'suntec', 'SunTec Release Management', true, 'client_visible', 10)
      ], 80)
    );
  }
  statuses.push(
    wfStatus('verification', 'Verification', 'normal', 'Verification', [
      task(`${prefix}_verify`, 'Verify resolution', level === 'L3' ? 'Obtain L2 verification/certification of the correction or release and record the result.' : 'Verify the resolution in the relevant environment and record the result.', level === 'L3' ? 'client' : ownerSide, level === 'L3' ? 'Client Application Support' : queue, true, 'client_visible', 10)
    ], includeDevelopment ? 90 : 70),
    wfStatus('resolved', 'Resolved', 'resolved', 'Resolved', [], includeDevelopment ? 100 : 80),
    wfStatus('duplicate', 'Duplicate', 'final', 'Duplicate', [], includeDevelopment ? 110 : 90),
    wfStatus('not_issue', 'Not an Issue', 'final', 'Not an Issue', [], includeDevelopment ? 120 : 100),
    wfStatus('cancelled', 'Cancelled', 'cancelled', 'Cancelled', [], includeDevelopment ? 130 : 110),
    wfStatus('closed', 'Closed', 'final', 'Closed', [], includeDevelopment ? 140 : 120)
  );
  const transitions = [
    tr('new','assigned'), tr('assigned','analysis'), tr('analysis','need_info'), tr('need_info','analysis'), tr('analysis','on_hold'), tr('on_hold','analysis'),
    tr('analysis','resolution'), tr('analysis','duplicate'), tr('analysis','not_issue'), tr('analysis','cancelled'), tr('resolution','analysis')
  ];
  if (includeDevelopment) transitions.push(tr('analysis','development'), tr('resolution','development'), tr('development','release'), tr('release','verification'));
  transitions.push(tr('resolution','verification'), tr('verification','resolution'), tr('verification','resolved'), tr('resolved','closed'));
  return { key, name, description, statuses, transitions, sourceLevel: level };
}

function ticketServiceRequestWorkflow({ key, name, description, ownerSide, queue, prefix }) {
  const visibility = ownerSide === 'suntec' ? 'internal_only' : 'client_visible';
  const statuses = [
    wfStatus('new','New','start','New',[],10),
    wfStatus('assigned','Assigned','normal','Assigned',[task(`${prefix}_accept`,'Accept service request','Confirm ownership and validate that the request is routed correctly.',ownerSide,queue,true,visibility,10)],20),
    wfStatus('analysis','Analysis','normal','Under Review',[task(`${prefix}_analyse`,'Analyse service request','Validate the requested service, required information, effort, dependencies, and fulfilment route.',ownerSide,queue,true,visibility,10)],30),
    wfStatus('need_info','Need Information','waiting','More Information Required',[task(`${prefix}_need`,'Request missing information','Record the information required before fulfilment can continue.',ownerSide,queue,false,'client_visible',10)],40),
    wfStatus('pending_approval','Pending Approval','waiting','Pending Approval',[task(`${prefix}_approval`,'Obtain approval when required','Record the applicable approval before fulfilment.',ownerSide,queue,true,visibility,10)],50),
    wfStatus('approved','Approved','normal','Approved',[],60),
    wfStatus('in_progress','In Progress','normal','In Progress',[task(`${prefix}_fulfil`,'Fulfil service request','Perform the requested service and record the result.',ownerSide,queue,true,visibility,10)],70),
    wfStatus('verification','Verification','normal','Verification',[task(`${prefix}_verify`,'Verify fulfilment','Verify the requested outcome and record customer confirmation/evidence.',ownerSide,queue,true,'client_visible',10)],80),
    wfStatus('completed','Completed','resolved','Completed',[],90),
    wfStatus('on_hold','On Hold','hold','On Hold',[],100),
    wfStatus('cancelled','Cancelled','cancelled','Cancelled',[],110),
    wfStatus('closed','Closed','final','Closed',[],120)
  ];
  const transitions = [tr('new','assigned'),tr('assigned','analysis'),tr('analysis','need_info'),tr('need_info','analysis'),tr('analysis','pending_approval'),tr('analysis','in_progress'),tr('analysis','on_hold'),tr('analysis','cancelled'),tr('pending_approval','approved'),tr('pending_approval','need_info'),tr('approved','in_progress'),tr('in_progress','verification'),tr('verification','in_progress'),tr('verification','completed'),tr('completed','closed'),tr('on_hold','analysis')];
  return { key, name, description, statuses, transitions };
}

function ticketChangeWorkflow({ key, name, description, ownerSide, queue, prefix }) {
  const visibility = ownerSide === 'suntec' ? 'internal_only' : 'client_visible';
  const statuses = [
    wfStatus('new','New','start','New',[],10),
    wfStatus('assigned','Assigned','normal','Assigned',[task(`${prefix}_accept`,'Accept change request','Confirm ownership, requested scope, and affected service.',ownerSide,queue,true,visibility,10)],20),
    wfStatus('assessment','Assessment','normal','Assessment',[task(`${prefix}_assess`,'Assess requested change','Assess business purpose, technical feasibility, dependencies, and affected services.',ownerSide,queue,true,visibility,10)],30),
    wfStatus('need_info','Need Information','waiting','More Information Required',[],40),
    wfStatus('impact','Impact Analysis','normal','Impact Analysis',[task(`${prefix}_impact`,'Complete impact analysis','Document impact, risk, outage expectations, testing needs, and rollback considerations.',ownerSide,queue,true,visibility,10)],50),
    wfStatus('change_plan','Change Plan','normal','Change Planning',[task(`${prefix}_plan`,'Prepare change plan','Prepare implementation, validation, communication, and rollback plan.',ownerSide,queue,true,visibility,10)],60),
    wfStatus('pending_approval','Pending Approval','waiting','Pending Approval',[task(`${prefix}_approval`,'Obtain change approval','Obtain and record the required change approval.',ownerSide,queue,true,visibility,10)],70),
    wfStatus('approved','Approved','normal','Approved',[],80),
    wfStatus('scheduled','Scheduled','waiting','Scheduled',[task(`${prefix}_schedule`,'Confirm change schedule','Confirm approved implementation window and stakeholder communications.',ownerSide,queue,true,'client_visible',10)],90),
    wfStatus('implementation','Implementation','normal','Implementation in Progress',[task(`${prefix}_implement`,'Implement approved change','Execute the approved change plan and record implementation evidence.',ownerSide,queue,true,visibility,10)],100),
    wfStatus('verification','Verification','normal','Verification',[task(`${prefix}_verify`,'Verify change outcome','Verify the change, service health, and expected business outcome.',ownerSide,queue,true,'client_visible',10)],110),
    wfStatus('rollback','Rollback','normal','Rollback in Progress',[task(`${prefix}_rollback`,'Execute rollback','Restore the prior stable state and record rollback evidence.',ownerSide,queue,true,visibility,10)],120),
    wfStatus('completed','Completed','resolved','Completed',[],130),
    wfStatus('on_hold','On Hold','hold','On Hold',[],140),
    wfStatus('cancelled','Cancelled','cancelled','Cancelled',[],150),
    wfStatus('closed','Closed','final','Closed',[],160)
  ];
  const transitions = [tr('new','assigned'),tr('assigned','assessment'),tr('assessment','need_info'),tr('need_info','assessment'),tr('assessment','impact'),tr('assessment','on_hold'),tr('assessment','cancelled'),tr('impact','change_plan'),tr('change_plan','pending_approval'),tr('pending_approval','approved'),tr('pending_approval','need_info'),tr('approved','scheduled'),tr('scheduled','implementation'),tr('implementation','verification'),tr('implementation','rollback'),tr('verification','completed'),tr('verification','rollback'),tr('rollback','assessment'),tr('completed','closed'),tr('on_hold','assessment')];
  return { key, name, description, statuses, transitions };
}

function ticketQueryWorkflow() {
  const statuses = [
    wfStatus('new','New','start','New',[],10),
    wfStatus('assigned','Assigned','normal','Assigned',[task('tkt_query_accept','Accept query','Confirm ownership of the customer query.','client','Client Help Desk',true,'client_visible',10)],20),
    wfStatus('need_info','Need Information','waiting','More Information Required',[task('tkt_query_need','Request clarification','Ask for any clarification required to answer the query.','client','Client Help Desk',false,'client_visible',10)],30),
    wfStatus('answered','Response Provided','resolved','Response Provided',[task('tkt_query_answer','Provide response','Provide the requested information or guidance in a customer-readable response.','client','Client Help Desk',true,'client_visible',10)],40),
    wfStatus('closed','Closed','final','Closed',[],50)
  ];
  return { key:'WF_TKT_QUERY', name:'Ticket – Query', description:'Straightforward query workflow: assign, clarify if needed, provide the answer, and close.', statuses, transitions:[tr('new','assigned'),tr('assigned','need_info'),tr('need_info','assigned'),tr('assigned','answered'),tr('answered','closed')] };
}

const TICKET_WORKFLOWS = [
  ticketIncidentWorkflow({ key:'WF_TKT_INC_L1', name:'Ticket Incident – L1 Client Help Desk', description:'Regular product-support incident workflow for Client L1 Help Desk.', ownerSide:'client', queue:'Client Help Desk', prefix:'tkt_inc_l1', level:'L1' }),
  ticketIncidentWorkflow({ key:'WF_TKT_INC_L2', name:'Ticket Incident – L2 Partner Support', description:'Regular product-support incident workflow for Partner / application support at L2.', ownerSide:'partner', queue:'Partner Support', prefix:'tkt_inc_l2', level:'L2' }),
  ticketIncidentWorkflow({ key:'WF_TKT_INC_L3', name:'Ticket Incident – L3 SunTec Product Support', description:'Regular product-support L3 workflow for SunTec product/solution defects, data errors, correction steps, and fix releases.', ownerSide:'suntec', queue:'SunTec Product Support', prefix:'tkt_inc_l3', level:'L3', includeDevelopment:true }),
  ticketServiceRequestWorkflow({ key:'WF_TKT_SR_L1', name:'Ticket Service Request – L1 Client Help Desk', description:'Generic regular-support service-request fulfilment workflow at L1.', ownerSide:'client', queue:'Client Help Desk', prefix:'tkt_sr_l1' }),
  ticketServiceRequestWorkflow({ key:'WF_TKT_SR_L2', name:'Ticket Service Request – L2 Partner Support', description:'Generic regular-support service-request fulfilment workflow for Partner support at L2.', ownerSide:'partner', queue:'Partner Support', prefix:'tkt_sr_l2' }),
  ticketServiceRequestWorkflow({ key:'WF_TKT_SR_L3', name:'Ticket Service Request – L3 SunTec', description:'Generic regular-support service-request fulfilment workflow requiring SunTec action.', ownerSide:'suntec', queue:'SunTec Product Support', prefix:'tkt_sr_l3' }),
  ticketChangeWorkflow({ key:'WF_TKT_CR_L1', name:'Ticket Change Request – L1 Client', description:'Regular-support controlled change workflow at L1.', ownerSide:'client', queue:'Client Help Desk', prefix:'tkt_cr_l1' }),
  ticketChangeWorkflow({ key:'WF_TKT_CR_L2', name:'Ticket Change Request – L2 Partner Support', description:'Regular-support controlled change workflow for Partner support at L2.', ownerSide:'partner', queue:'Partner Support', prefix:'tkt_cr_l2' }),
  ticketChangeWorkflow({ key:'WF_TKT_CR_L3', name:'Ticket Change Request – L3 SunTec', description:'Regular-support controlled product/change workflow requiring SunTec involvement.', ownerSide:'suntec', queue:'SunTec Product Support', prefix:'tkt_cr_l3' }),
  ticketQueryWorkflow()
];

const WORKFLOWS = [
  buildIncidentWorkflow({
    key: 'WF_INC_APP_L1', name: 'Application Incident – L1 Bank', description: 'Bank-owned L1 application incident analysis, resolution, verification, and closure workflow.',
    prefix: 'xw_app_l1', ownerSide: 'client', queue: 'Bank Service Desk', visibility: 'client_visible', level: 'L1'
  }),
  buildIncidentWorkflow({
    key: 'WF_INC_APP_L2', name: 'Application Incident – L2 Partner', description: 'Partner-owned L2 application incident workflow with environment verification, Bank verification, RCA, and closure approval.',
    prefix: 'xw_app_l2', ownerSide: 'partner', queue: 'Partner L2 Support', visibility: 'partner_visible', level: 'L2', includeBankVerify: true
  }),
  buildIncidentWorkflow({
    key: 'WF_INC_APP_L3', name: 'Application Incident – L3 SunTec', description: 'SunTec L3 application incident workflow covering advanced analysis, development, release, client-environment deployment, Bank verification, RCA, and closure.',
    prefix: 'xw_app_l3', ownerSide: 'suntec', queue: 'SunTec L3 Support', visibility: 'internal_only', level: 'L3', includeDevelopment: true, includeBankVerify: true
  }),
  buildIncidentWorkflow({
    key: 'WF_INC_SEC_L2', name: 'Security Incident – L2 Partner', description: 'Partner L2 security incident workflow with customer notification, hardening/configuration resolution, verification, RCA, and closure.',
    prefix: 'xw_sec_l2', ownerSide: 'partner', queue: 'Partner Security Operations', visibility: 'partner_visible', level: 'L2', security: true
  }),
  buildIncidentWorkflow({
    key: 'WF_INC_SEC_L3', name: 'Security Incident – L3 SunTec', description: 'SunTec L3 security incident workflow with customer notification, engineering remediation, release, verification, RCA, and closure.',
    prefix: 'xw_sec_l3', ownerSide: 'suntec', queue: 'SunTec Security Support', visibility: 'internal_only', level: 'L3', includeDevelopment: true, security: true
  }),
  buildIncidentWorkflow({
    key: 'WF_INC_OPS_L2', name: 'Operational Incident – L2 Partner', description: 'Partner L2 operational incident workflow for day-to-day managed-service incidents and escalation to SunTec.',
    prefix: 'xw_ops_l2', ownerSide: 'partner', queue: 'Partner Operations', visibility: 'partner_visible', level: 'L2'
  }),
  buildIncidentWorkflow({
    key: 'WF_INC_OPS_L3', name: 'Operational Incident – L3 SunTec', description: 'SunTec L3 operational incident workflow with platform/product remediation, release, verification, RCA, and closure.',
    prefix: 'xw_ops_l3', ownerSide: 'suntec', queue: 'SunTec Operations Support', visibility: 'internal_only', level: 'L3', includeDevelopment: true
  }),
  buildIncidentWorkflow({
    key: 'WF_INC_INF_L2', name: 'Infrastructure Incident – L2 Partner', description: 'Partner L2 infrastructure incident workflow for restoration, rollback, verification, and SunTec escalation.',
    prefix: 'xw_inf_l2', ownerSide: 'partner', queue: 'Partner Infrastructure Operations', visibility: 'partner_visible', level: 'L2'
  }),
  buildIncidentWorkflow({
    key: 'WF_INC_INF_L3', name: 'Infrastructure Incident – L3 SunTec', description: 'SunTec L3 infrastructure workflow covering advanced diagnosis, vendor support, platform fixes, release, verification, RCA, and closure.',
    prefix: 'xw_inf_l3', ownerSide: 'suntec', queue: 'SunTec Infrastructure Support', visibility: 'internal_only', level: 'L3', includeDevelopment: true, includeVendor: true
  })
];
WORKFLOWS.unshift(...TICKET_WORKFLOWS);

function standardApprovalWorkflow({ key, name, description, ownerSide, queue, prefix }) {
  const visibility = ownerSide === 'client' ? 'client_visible' : ownerSide === 'partner' ? 'partner_visible' : 'internal_only';
  const statuses = [
    wfStatus('new', 'New', 'start', 'New', [], 10),
    wfStatus('assigned', 'Assigned', 'normal', 'Assigned', [
      task(`${prefix}_accept`, 'Accept request ownership', 'Confirm ownership and validate that the request is assigned to the correct team.', ownerSide, queue, true, visibility, 10),
      task(`${prefix}_validate`, 'Validate mandatory request details', 'Validate requester authority, environment, business purpose, required evidence, and request-specific fields.', ownerSide, queue, true, 'client_visible', 20)
    ], 20),
    wfStatus('analysis', 'Analysis', 'normal', 'Under Review', [
      task(`${prefix}_analyse`, 'Analyse request', 'Review the request, assess impact, identify approvers, and confirm the execution plan.', ownerSide, queue, true, visibility, 10),
      task(`${prefix}_approval_route`, 'Confirm approval route', 'Identify the correct approver or approval group and record the approval requirement.', ownerSide, queue, true, visibility, 20)
    ], 30),
    wfStatus('need_info', 'Need Info', 'waiting', 'More Information Required', [
      task(`${prefix}_need_info`, 'Request missing information', 'Record the information or correction required before the request can proceed.', ownerSide, queue, false, 'client_visible', 10)
    ], 40),
    wfStatus('pending_approval', 'Pending Approval', 'waiting', 'Pending Approval', [
      task(`${prefix}_approval`, 'Obtain approval', 'Obtain and record the required approval before execution.', ownerSide, queue, true, visibility, 10)
    ], 50),
    wfStatus('approved', 'Approved', 'normal', 'Approved', [], 60),
    wfStatus('active', 'Active', 'normal', 'In Progress', [
      task(`${prefix}_execute`, 'Execute approved request', 'Perform the approved request and record the action taken and result.', ownerSide, queue, true, visibility, 10)
    ], 70),
    wfStatus('verification', 'Verification', 'normal', 'Verification', [
      task(`${prefix}_verify`, 'Verify request completion', 'Verify the requested outcome in the relevant environment and record evidence.', ownerSide, queue, true, 'client_visible', 10),
      task(`${prefix}_notify`, 'Notify requester of completion', 'Provide a customer-safe completion update and any follow-up instructions.', ownerSide, queue, false, 'client_visible', 20)
    ], 80),
    wfStatus('resolved', 'Resolved', 'resolved', 'Resolved', [], 90),
    wfStatus('on_hold', 'On Hold', 'hold', 'On Hold', [], 100),
    wfStatus('deferred', 'Deferred', 'hold', 'Deferred', [], 110),
    wfStatus('duplicate', 'Duplicate', 'final', 'Duplicate', [], 120),
    wfStatus('cancelled', 'Cancelled', 'cancelled', 'Cancelled', [], 130),
    wfStatus('closed', 'Closed', 'final', 'Closed', [], 140)
  ];
  const transitions = [
    tr('new', 'assigned'), tr('assigned', 'analysis'), tr('analysis', 'pending_approval'), tr('analysis', 'need_info'), tr('analysis', 'duplicate'), tr('analysis', 'deferred'), tr('analysis', 'on_hold'), tr('analysis', 'cancelled'),
    tr('need_info', 'analysis'), tr('pending_approval', 'approved'), tr('pending_approval', 'need_info'), tr('approved', 'active'), tr('active', 'verification'), tr('verification', 'active'), tr('verification', 'resolved'), tr('resolved', 'closed'),
    tr('on_hold', 'analysis'), tr('deferred', 'analysis')
  ];
  return { key, name, description, statuses, transitions };
}

WORKFLOWS.push(
  standardApprovalWorkflow({ key: 'WF_SR_L1_BANK', name: 'Service Request – L1 Bank Approval', description: 'Bank-owned service request approval and fulfilment workflow.', ownerSide: 'client', queue: 'Bank Service Desk', prefix: 'sr_l1' }),
  standardApprovalWorkflow({ key: 'WF_SR_L2_PARTNER', name: 'Service Request – L2 Partner Approval', description: 'Partner-owned service request approval and fulfilment workflow.', ownerSide: 'partner', queue: 'Partner Service Operations', prefix: 'sr_l2' }),
  standardApprovalWorkflow({ key: 'WF_SR_L3_SUNTEC', name: 'Service Request – L3 SunTec Approval', description: 'SunTec-owned service request approval and fulfilment workflow.', ownerSide: 'suntec', queue: 'SunTec SaaS CoE', prefix: 'sr_l3' })
);

function privilegedAccessWorkflow() {
  const prefix = 'sr_priv';
  const statuses = [
    wfStatus('new', 'New', 'start', 'New', [], 10),
    wfStatus('assigned', 'Assigned', 'normal', 'Assigned', [task(`${prefix}_accept`, 'Accept privileged access request', 'Confirm ownership and validate requester identity.', 'suntec', 'SunTec SaaS CoE Infosec', true, 'internal_only', 10)], 20),
    wfStatus('analysis', 'Analysis', 'normal', 'Under Review', [
      task(`${prefix}_justify`, 'Validate business justification and scope', 'Validate business justification, requested privileges, scope of access, and duration.', 'suntec', 'SunTec SaaS CoE Infosec', true, 'internal_only', 10),
      task(`${prefix}_duration`, 'Validate access duration', 'Confirm the requested duration and revocation time.', 'suntec', 'SunTec SaaS CoE Infosec', true, 'internal_only', 20)
    ], 30),
    wfStatus('need_info', 'Need Info', 'waiting', 'More Information Required', [], 40),
    wfStatus('pending_approval', 'Pending Approval', 'waiting', 'Pending Approval', [task(`${prefix}_approval`, 'Obtain privileged-access approval', 'Obtain approval from SaaS CoE Head, SaaS CISO, or SunTec Global Support Manager.', 'suntec', 'SunTec SaaS CoE Infosec', true, 'internal_only', 10)], 50),
    wfStatus('approved', 'Approved', 'normal', 'Approved', [], 60),
    wfStatus('access_granted', 'Access Granted', 'normal', 'Access Granted', [
      task(`${prefix}_grant`, 'Grant privileged access', 'Grant only the approved privileged access and record the action.', 'suntec', 'SunTec SaaS CoE Infosec', true, 'internal_only', 10),
      task(`${prefix}_secret`, 'Rotate or secure retrieved secrets', 'Change or rotate secrets/keys as required before storing them back in the secrets manager.', 'suntec', 'SunTec SaaS CoE Infosec', true, 'internal_only', 20)
    ], 70),
    wfStatus('access_revoke', 'Access Revoke', 'normal', 'Access Revocation', [task(`${prefix}_revoke`, 'Revoke elevated privileges', 'Revoke all elevated privileges before closure and record verification.', 'suntec', 'SunTec SaaS CoE Infosec', true, 'internal_only', 10)], 80),
    wfStatus('verification', 'Verification', 'normal', 'Verification', [task(`${prefix}_verify`, 'Verify access revocation', 'Confirm elevated privileges are removed and the account is back to its approved baseline.', 'suntec', 'SunTec SaaS CoE Infosec', true, 'client_visible', 10)], 90),
    wfStatus('resolved', 'Resolved', 'resolved', 'Resolved', [], 100),
    wfStatus('on_hold', 'On Hold', 'hold', 'On Hold', [], 110),
    wfStatus('deferred', 'Deferred', 'hold', 'Deferred', [], 120),
    wfStatus('duplicate', 'Duplicate', 'final', 'Duplicate', [], 130),
    wfStatus('cancelled', 'Cancelled', 'cancelled', 'Cancelled', [], 140),
    wfStatus('closed', 'Closed', 'final', 'Closed', [], 150)
  ];
  const transitions = [tr('new','assigned'),tr('assigned','analysis'),tr('analysis','pending_approval'),tr('analysis','need_info'),tr('analysis','duplicate'),tr('analysis','deferred'),tr('analysis','on_hold'),tr('analysis','cancelled'),tr('need_info','analysis'),tr('pending_approval','approved'),tr('pending_approval','need_info'),tr('approved','access_granted'),tr('access_granted','access_revoke'),tr('access_revoke','verification'),tr('verification','resolved'),tr('resolved','closed'),tr('on_hold','analysis'),tr('deferred','analysis')];
  return { key: 'WF_SR_PRIVILEGED', name: 'Service Request – Privileged Access', description: 'SunTec privileged access workflow with approval, time-bound access, mandatory revocation, and verification before closure.', statuses, transitions };
}

function drDrillWorkflow() {
  const prefix = 'sr_dr';
  const statuses = [
    wfStatus('new','New','start','New',[],10),
    wfStatus('assigned','Assigned','normal','Assigned',[task(`${prefix}_accept`,'Accept DR drill request','Confirm Partner ownership and validate the published DR calendar entry.','partner','Partner DR Operations',true,'partner_visible',10)],20),
    wfStatus('dr_analysis','DR Drill Analysis','normal','DR Drill Analysis',[task(`${prefix}_analyse`,'Validate DR drill plan','Validate DR location, dates, switchover time, drill period, production switchback date, stakeholders, and prerequisites.','partner','Partner DR Operations',true,'partner_visible',10)],30),
    wfStatus('pending_approval','Pending Approval','waiting','Pending Approval',[task(`${prefix}_approval`,'Obtain DR drill approval','Obtain Bank and SunTec support approval for the DR drill.','partner','Partner DR Operations',true,'client_visible',10)],40),
    wfStatus('approved','Approved','normal','Approved',[],50),
    wfStatus('pre_checks','Pre-Checks','normal','Pre-Checks',[task(`${prefix}_prechecks`,'Complete DR pre-checks','Complete recovery, replication, monitoring, access, communications, and rollback pre-checks.','partner','Partner DR Operations',true,'partner_visible',10)],60),
    wfStatus('switch_to_dr','Initiate Switch to DR','normal','Switching to DR',[task(`${prefix}_switch_dr`,'Switch service to DR','Execute the approved switch to DR and record the result.','partner','Partner DR Operations',true,'partner_visible',10)],70),
    wfStatus('dr_active','Switched to DR','normal','DR Active',[task(`${prefix}_verify_dr`,'Verify DR environment','Verify service availability and record DR observations.','partner','Partner DR Operations',true,'client_visible',10)],80),
    wfStatus('switchback','Initiate Switchback to Primary','normal','Switchback to Primary',[task(`${prefix}_switchback_approval`,'Confirm production switchback readiness','Confirm production readiness and Bank/SunTec approval before switchback.','partner','Partner DR Operations',true,'client_visible',10)],90),
    wfStatus('primary_active','Switched to Primary','normal','Primary Restored',[task(`${prefix}_verify_primary`,'Verify production after switchback','Verify Production is operating correctly after switchback.','partner','Partner DR Operations',true,'client_visible',10)],100),
    wfStatus('report_prep','BCP Report Preparation','normal','BCP Report Preparation',[task(`${prefix}_report`,'Prepare DR/BCP report','Prepare DR/BCP results, findings, weak points, and corrective actions.','partner','Partner DR Operations',true,'partner_visible',10)],110),
    wfStatus('report_published','BCP Report Published','resolved','BCP Report Published',[task(`${prefix}_publish`,'Publish DR/BCP report','Publish the approved DR/BCP report and evidence link.','partner','Partner DR Operations',true,'client_visible',10)],120),
    wfStatus('deferred','Deferred','hold','Deferred',[],130),wfStatus('duplicate','Duplicate','final','Duplicate',[],140),wfStatus('cancelled','Cancelled','cancelled','Cancelled',[],150),wfStatus('closed','Closed','final','Closed',[],160)
  ];
  const transitions=[tr('new','assigned'),tr('assigned','dr_analysis'),tr('dr_analysis','pending_approval'),tr('dr_analysis','deferred'),tr('dr_analysis','duplicate'),tr('dr_analysis','cancelled'),tr('pending_approval','approved'),tr('pending_approval','dr_analysis'),tr('approved','pre_checks'),tr('pre_checks','switch_to_dr'),tr('switch_to_dr','dr_active'),tr('dr_active','switchback'),tr('switchback','primary_active'),tr('primary_active','report_prep'),tr('report_prep','report_published'),tr('report_published','closed'),tr('deferred','dr_analysis')];
  return { key:'WF_SR_DR_DRILL', name:'Service Request – DR Drill / BCP', description:'Partner DR drill and business-continuity workflow covering approval, DR switchover, switchback, verification, and BCP reporting.', statuses, transitions };
}

function temporaryChangeWorkflow({ key, name, description, prefix, activeStatus, restoreStatus, activeTaskTitle, restoreTaskTitle }) {
  const statuses=[
    wfStatus('new','New','start','New',[],10),
    wfStatus('assigned','Assigned','normal','Assigned',[task(`${prefix}_accept`,'Accept request','Confirm ownership and validate request details.','suntec','SunTec Operations',true,'internal_only',10)],20),
    wfStatus('analysis','Analysis','normal','Under Review',[task(`${prefix}_analyse`,'Validate request and limits','Validate environment, requested period, approval route, and operational constraints.','suntec','SunTec Operations',true,'internal_only',10)],30),
    wfStatus('need_info','Need Info','waiting','More Information Required',[],40),
    wfStatus('pending_approval','Pending Approval','waiting','Pending Approval',[task(`${prefix}_approval`,'Obtain approval','Obtain required stakeholder approval before making the temporary change.','suntec','SunTec Operations',true,'internal_only',10)],50),
    wfStatus('approved','Approved','normal','Approved',[],60),
    wfStatus('active_change',activeStatus,'normal',activeStatus,[task(`${prefix}_activate`,activeTaskTitle,'Apply the approved temporary change and record the start time and evidence.','suntec','SunTec Operations',true,'internal_only',10)],70),
    wfStatus('restore',restoreStatus,'normal',restoreStatus,[task(`${prefix}_restore`,restoreTaskTitle,'Restore the previous/baseline configuration and record the result.','suntec','SunTec Operations',true,'internal_only',10)],80),
    wfStatus('verification','Verification','normal','Verification',[task(`${prefix}_verify`,'Verify baseline restored','Verify the service is stable and the temporary change is fully reverted.','suntec','SunTec Operations',true,'client_visible',10)],90),
    wfStatus('resolved','Resolved','resolved','Resolved',[],100),wfStatus('on_hold','On Hold','hold','On Hold',[],110),wfStatus('deferred','Deferred','hold','Deferred',[],120),wfStatus('duplicate','Duplicate','final','Duplicate',[],130),wfStatus('cancelled','Cancelled','cancelled','Cancelled',[],140),wfStatus('closed','Closed','final','Closed',[],150)
  ];
  const transitions=[tr('new','assigned'),tr('assigned','analysis'),tr('analysis','pending_approval'),tr('analysis','need_info'),tr('analysis','on_hold'),tr('analysis','deferred'),tr('analysis','duplicate'),tr('analysis','cancelled'),tr('need_info','analysis'),tr('pending_approval','approved'),tr('pending_approval','analysis'),tr('approved','active_change'),tr('active_change','restore'),tr('restore','verification'),tr('verification','resolved'),tr('verification','active_change'),tr('resolved','closed'),tr('on_hold','analysis'),tr('deferred','analysis')];
  return { key,name,description,statuses,transitions };
}

WORKFLOWS.push(
  privilegedAccessWorkflow(),
  drDrillWorkflow(),
  temporaryChangeWorkflow({ key:'WF_SR_ENV_WINDOW', name:'Service Request – AWS Environment Window', description:'Temporary non-production AWS environment start/stop window approval workflow with restoration to the normal schedule.', prefix:'sr_env', activeStatus:'Extended Window Active', restoreStatus:'Schedule Restored', activeTaskTitle:'Apply extended environment window', restoreTaskTitle:'Restore standard environment schedule' }),
  temporaryChangeWorkflow({ key:'WF_SR_DEBUG', name:'Service Request – Debug Log Level', description:'Temporary application DEBUG log-level approval workflow with mandatory restoration after the approved period.', prefix:'sr_debug', activeStatus:'Debug Mode Active', restoreStatus:'Normal Log Level Restored', activeTaskTitle:'Enable DEBUG log level', restoreTaskTitle:'Restore normal log level' })
);

function maintenanceReleaseWorkflow() {
  const p='mr_rel';
  const statuses=[
    wfStatus('new','New','start','New',[],10),
    wfStatus('assigned','Assigned','normal','Assigned',[task(`${p}_accept`,'Accept maintenance request','Confirm Partner ownership and validate release ID, environment, duration, components, and evidence.','partner','Partner DevOps',true,'partner_visible',10)],20),
    wfStatus('analysis','Analysis','normal','Under Review',[task(`${p}_analyse`,'Validate release and test evidence','Review release note, impacted components, prior-environment test evidence, deployment sequence, and rollback plan.','partner','Partner DevOps',true,'partner_visible',10)],30),
    wfStatus('need_info','Need Info','waiting','More Information Required',[],40),
    wfStatus('pending_approval','Pending Approval','waiting','Pending Approval',[task(`${p}_approval`,'Obtain maintenance approvals','For non-production obtain Partner and SunTec approval; for Production obtain Partner, Bank, and SunTec approval.','partner','Partner DevOps',true,'client_visible',10)],50),
    wfStatus('approved','Approved','normal','Approved',[],60),
    wfStatus('maintenance','Maintenance in Progress','normal','Maintenance in Progress',[task(`${p}_execute`,'Apply approved release/maintenance','Apply the approved release or maintenance activity and record implementation evidence.','partner','Partner DevOps',true,'partner_visible',10)],70),
    wfStatus('verification','Verification','normal','Verification',[task(`${p}_verify`,'Verify maintenance result','Verify the environment after maintenance and record test results.','partner','Partner DevOps',true,'client_visible',10)],80),
    wfStatus('rollback','Rollback','normal','Rollback in Progress',[task(`${p}_rollback`,'Rollback failed maintenance','Restore the previous stable state and record rollback evidence.','partner','Partner DevOps',true,'partner_visible',10)],90),
    wfStatus('completed','Completed','resolved','Completed',[task(`${p}_complete`,'Publish completion evidence','Publish the completion result, test evidence, and stakeholder notification.','partner','Partner DevOps',true,'client_visible',10)],100),
    wfStatus('on_hold','On Hold','hold','On Hold',[],110),wfStatus('deferred','Deferred','hold','Deferred',[],120),wfStatus('cancelled','Cancelled','cancelled','Cancelled',[],130),wfStatus('closed','Closed','final','Closed',[],140)
  ];
  const transitions=[tr('new','assigned'),tr('assigned','analysis'),tr('analysis','pending_approval'),tr('analysis','need_info'),tr('analysis','on_hold'),tr('analysis','deferred'),tr('analysis','cancelled'),tr('need_info','analysis'),tr('pending_approval','approved'),tr('pending_approval','analysis'),tr('approved','maintenance'),tr('maintenance','verification'),tr('verification','completed'),tr('verification','rollback'),tr('rollback','analysis'),tr('completed','closed'),tr('on_hold','analysis'),tr('deferred','analysis')];
  return { key:'WF_MR_RELEASE', name:'Maintenance – Release Application', description:'Partner-owned scheduled, proactive, and emergency release application workflow with approval, verification, and rollback.', statuses, transitions };
}

function maintenanceDrWorkflow() {
  const p='mr_dr';
  const statuses=[
    wfStatus('new','New','start','New',[],10),wfStatus('assigned','Assigned','normal','Assigned',[task(`${p}_accept`,'Accept Actual DR request','Confirm Partner ownership and validate the disaster/switchover context.','partner','Partner DR Operations',true,'partner_visible',10)],20),
    wfStatus('analysis','Analysis','normal','Under Review',[task(`${p}_analyse`,'Validate DR switchover request','Validate DR location, reason, RTO/RPO expectations, switchover time, dependencies, and communications.','partner','Partner DR Operations',true,'partner_visible',10)],30),
    wfStatus('need_info','Need Info','waiting','More Information Required',[],40),wfStatus('pending_approval','Pending Approval','waiting','Pending Approval',[task(`${p}_approval`,'Obtain DR switchover approval','Obtain Bank and SunTec support approval for the DR movement.','partner','Partner DR Operations',true,'client_visible',10)],50),
    wfStatus('approved','Approved','normal','Approved',[],60),
    wfStatus('dr_switch','DR Switch in Progress','normal','DR Switch in Progress',[task(`${p}_switch`,'Switch to DR','Execute DR switchover within the agreed RTO/RPO and record the result.','partner','Partner DR Operations',true,'partner_visible',10)],70),
    wfStatus('dr_active','DR Active','normal','DR Active',[task(`${p}_publish_rpo`,'Publish achieved RPO/RTO','Publish the achieved RPO/RTO and verify service operation in DR.','partner','Partner DR Operations',true,'client_visible',10)],80),
    wfStatus('switchback_approval','Production Switchback Approval','waiting','Production Switchback Approval',[task(`${p}_switchback_approval`,'Obtain production switchback approval','Confirm Production readiness and obtain Bank/SunTec approval to switch back.','partner','Partner DR Operations',true,'client_visible',10)],90),
    wfStatus('switchback','Production Switchback','normal','Production Switchback',[task(`${p}_switchback`,'Switch back to Production','Execute approved production switchback and record the result.','partner','Partner DR Operations',true,'partner_visible',10)],100),
    wfStatus('verification','Production Verification','normal','Production Verification',[task(`${p}_verify_prod`,'Verify Production after switchback','Verify production readiness, service health, and successful recovery.','partner','Partner DR Operations',true,'client_visible',10)],110),
    wfStatus('completed','Completed','resolved','Completed',[],120),wfStatus('on_hold','On Hold','hold','On Hold',[],130),wfStatus('deferred','Deferred','hold','Deferred',[],140),wfStatus('cancelled','Cancelled','cancelled','Cancelled',[],150),wfStatus('closed','Closed','final','Closed',[],160)
  ];
  const transitions=[tr('new','assigned'),tr('assigned','analysis'),tr('analysis','pending_approval'),tr('analysis','need_info'),tr('analysis','on_hold'),tr('analysis','deferred'),tr('analysis','cancelled'),tr('need_info','analysis'),tr('pending_approval','approved'),tr('pending_approval','analysis'),tr('approved','dr_switch'),tr('dr_switch','dr_active'),tr('dr_active','switchback_approval'),tr('switchback_approval','switchback'),tr('switchback_approval','dr_active'),tr('switchback','verification'),tr('verification','completed'),tr('verification','dr_active'),tr('completed','closed'),tr('on_hold','analysis'),tr('deferred','analysis')];
  return { key:'WF_MR_ACTUAL_DR', name:'Maintenance – Actual DR', description:'Actual disaster-recovery switchover and production switchback workflow with approvals and RPO/RTO publication.', statuses, transitions };
}

function scanMaintenanceWorkflow({ key,name,description,prefix,penTest=false }) {
  const statuses=[
    wfStatus('new','New','start','New',[],10),wfStatus('assigned','Assigned','normal','Assigned',[task(`${prefix}_accept`,'Accept scan request','Confirm Partner ownership, scope, components, and planned scan date.','partner','Partner Security Operations',true,'partner_visible',10)],20),
    wfStatus('analysis','Analysis','normal','Under Review',[task(`${prefix}_scope`,'Validate scan scope','Validate components, schedule, prerequisites, and stakeholders.', 'partner','Partner Security Operations',true,'partner_visible',10),...(penTest?[task(`${prefix}_aws`,'Confirm AWS Security notification/approval','Inform AWS Security of the penetration test schedule and record the required approval.','suntec','SunTec SaaS CoE',true,'internal_only',20)]:[])],30),
    wfStatus('need_info','Need Info','waiting','More Information Required',[],40),wfStatus('pending_approval','Pending Approval','waiting','Pending Approval',[task(`${prefix}_approval`,'Obtain scan approval','Obtain SunTec Support and SaaS CoE approval before the scheduled activity.','partner','Partner Security Operations',true,'internal_only',10)],50),
    wfStatus('approved','Approved','normal','Approved',[],60),wfStatus('scan','Scan in Progress','normal','Scan in Progress',[task(`${prefix}_run`,'Run approved security activity','Run the approved security scan/test on the scheduled date and record execution evidence.','partner','Partner Security Operations',true,'internal_only',10)],70),
    wfStatus('scan_complete','Scan Complete','normal','Scan Complete',[task(`${prefix}_report`,'Publish report to SunTec Support','Publish the scan/test report to SunTec Support for review.','partner','Partner Security Operations',true,'partner_visible',10)],80),
    wfStatus('report_review','Report Under Review','normal','Report Under Review',[task(`${prefix}_review`,'Evaluate report and route findings','Evaluate findings and route issues by priority to the appropriate problem-management flow.','suntec','SunTec SaaS CoE',true,'internal_only',10)],90),
    wfStatus('report_shared','Report Shared with Client','resolved','Report Shared with Client',[task(`${prefix}_share`,'Publish client result and resolution schedule','Publish the customer-safe result and remediation schedule to the client.','suntec','SunTec SaaS CoE',true,'client_visible',10)],100),
    wfStatus('on_hold','On Hold','hold','On Hold',[],110),wfStatus('deferred','Deferred','hold','Deferred',[],120),wfStatus('cancelled','Cancelled','cancelled','Cancelled',[],130),wfStatus('closed','Closed','final','Closed',[],140)
  ];
  const transitions=[tr('new','assigned'),tr('assigned','analysis'),tr('analysis','pending_approval'),tr('analysis','need_info'),tr('analysis','on_hold'),tr('analysis','deferred'),tr('analysis','cancelled'),tr('need_info','analysis'),tr('pending_approval','approved'),tr('pending_approval','analysis'),tr('approved','scan'),tr('scan','scan_complete'),tr('scan_complete','report_review'),tr('report_review','report_shared'),tr('report_shared','closed'),tr('on_hold','analysis'),tr('deferred','analysis')];
  return { key,name,description,statuses,transitions };
}

WORKFLOWS.push(
  maintenanceReleaseWorkflow(),
  maintenanceDrWorkflow(),
  scanMaintenanceWorkflow({ key:'WF_MR_VULN', name:'Maintenance – Vulnerability Run', description:'Infrastructure vulnerability-scan approval, execution, report review, and client publication workflow.', prefix:'mr_vuln' }),
  scanMaintenanceWorkflow({ key:'WF_MR_PENTEST', name:'Maintenance – Penetration Test', description:'Infrastructure penetration-test approval, AWS Security coordination, execution, report review, and client publication workflow.', prefix:'mr_pentest', penTest:true })
);

const ISSUE_FAMILIES = [
  { symbol:'TKT', key:'TICKET', name:'Ticket', aliases:['Tickets'], description:'Regular/Product Support operating process covering Incident, Service Request, Change Request, and Query.', icon:'T', displayOrder:10 },
  { symbol:'INC', key:'INC', name:'Incident', aliases:['Inc','Incident Management'], description:'SaaS Incident Management: unplanned interruptions or reductions in service quality across application, security, operational, and infrastructure domains.', icon:'!', displayOrder:20 },
  { symbol:'MR', key:'MAINTENANCE_REQUEST', name:'Maintenance Request', aliases:['MR'], description:'SaaS maintenance activities including release application, proactive/emergency maintenance, DR, vulnerability scans, and penetration tests.', icon:'M', displayOrder:30 },
  { symbol:'SR', key:'SERVICE_REQUEST', name:'Service Request', aliases:['SR'], description:'SaaS service requests requiring approval or controlled fulfilment across Bank, Partner, and SunTec support.', icon:'R', displayOrder:40 }
];

const ISSUE_TYPES = [
  { symbol:'TKT_INC', family:'TKT', key:'INCIDENT', name:'Incident', aliases:['Ticket Incident'], description:'Regular product-support incident routed through Customer L1, Partner L2, and SunTec L3 as required.', displayOrder:10, fieldsConfig:{ severity:true, priority:true, product:true, module:true, region:false, environment:true }, customFields:[], defaultWorkflow:'WF_TKT_INC_L1', defaultPath:'PATH_TKT_INC' },
  { symbol:'TKT_SR', family:'TKT', key:'SERVICE_REQUEST', name:'Service Request', aliases:['Ticket Service Request'], description:'Regular product-support request for a defined service or fulfilment activity.', displayOrder:20, fieldsConfig:{ severity:false, priority:true, product:true, module:true, region:false, environment:true }, customFields:[], defaultWorkflow:'WF_TKT_SR_L1', defaultPath:'PATH_TKT_SR' },
  { symbol:'TKT_CR', family:'TKT', key:'CHANGE_REQUEST', name:'Change Request', aliases:['Ticket Change Request'], description:'Regular product-support controlled change process covering assessment, impact analysis, approval, implementation, verification, and rollback.', displayOrder:30, fieldsConfig:{ severity:false, priority:true, product:true, module:true, region:false, environment:true }, customFields:[], defaultWorkflow:'WF_TKT_CR_L1', defaultPath:'PATH_TKT_CR' },
  { symbol:'TKT_QUERY', family:'TKT', key:'QUERY', name:'Query', aliases:['Ticket Query'], description:'Straightforward information or guidance query: assign, clarify if necessary, answer, and close.', displayOrder:40, fieldsConfig:{ severity:false, priority:false, product:true, module:true, region:false, environment:false }, customFields:[], defaultWorkflow:'WF_TKT_QUERY', defaultPath:'PATH_TKT_QUERY' },
  {
    symbol:'INC_APP', family:'INC', key:'APPLICATION', name:'Application', aliases:['Application Incident'], description:'Application incidents covering UI, application server, access, data, batch, API, configuration, and performance issues.', displayOrder:10,
    fieldsConfig:{ severity:true, priority:false, product:false, module:false, region:false, environment:true },
    customFields:[
      field('INCIDENT_SUBTYPE','Incident Subtype','dropdown',false,'Classify the Application incident.',[
        'UI Functional Issue','Application Server Issue','User Access Issue','Password Issue','Business Data Issue','Library Data Issue','System Configuration Issue','Functional Issue','Batch Processing Issue','DB Data Issue','Process Container Issue','Suspense Processing Issue','DB Data Level Issue','Database Issue','API Issue','UI Performance Issue','Batch Performance Issue','API Performance Issue'
      ],10),
      field('AFFECTED_COMPONENTS','Affected Components','dropdown',false,'',['Application Server','Process Container','X3 Components','Nifi','Kafka','Database'],20),
      field('AFFECTED_FUNCTIONALITY','Affected Functionality','dropdown',false,'',['User Interface','Batch Process','API Process','Customer/Account','Pricing','Deal','Outbound'],30),
      ...COMMON_INCIDENT_FIELDS
    ],
    defaultWorkflow:'WF_INC_APP_L1', defaultPath:'PATH_INC_APP_STANDARD'
  },
  {
    symbol:'INC_SEC', family:'INC', key:'SECURITY', name:'Security', aliases:['Security Incident'], description:'Security incidents reported by monitoring, VAPT, clients, regulators, or third parties.', displayOrder:20,
    fieldsConfig:{ severity:true, priority:false, product:false, module:false, region:false, environment:true },
    customFields:[
      field('INCIDENT_SUBTYPE','Incident Subtype','dropdown',false,'Classify the Security incident.',[
        'Unauthorised Access or Unsuccessful Access Attempts','Privileged/System Account Monitoring Issue','AWS Shield or Security Monitoring Alert','Sensitive Data Access','Denial of Service (DoS/DDoS)','Malicious Code / Malware','Network Related Security Attack','Unauthorized Data Deletion/Modification','Application Attack'
      ],10),
      field('AFFECTED_COMPONENTS','Affected Components','dropdown',false,'',['Application','Infrastructure','Network Firewall','User Access'],20),
      field('SECURITY_SERVICE_AFFECTED','Security Service Affected','dropdown',false,'',['Xelerate','Palo Alto Firewall','SIEM Tool','Security Group','Network ACL','OS Patching','Jenkins','IAM','Bastion Host','EDR','Cloud Watch','Guard Duty','DB Patching'],30),
      ...COMMON_INCIDENT_FIELDS
    ],
    defaultWorkflow:'WF_INC_SEC_L2', defaultPath:'PATH_INC_SEC_STANDARD'
  },
  {
    symbol:'INC_OPS', family:'INC', key:'OPERATIONAL', name:'Operational', aliases:['Operations','Operational Incident'], description:'Operational incidents arising from managed-service activities such as patches, batch, CI/CD, reports, email, ticketing, environment access, monitoring, and DR.', displayOrder:30,
    fieldsConfig:{ severity:true, priority:false, product:false, module:false, region:false, environment:true },
    customFields:[
      field('INCIDENT_SUBTYPE','Incident Subtype','dropdown',false,'',['Patch Application Issue','Batch Process Issue','CI/CD Pipeline Issue','Report Issue','Email Issue','Ticketing Tool Issue','Environment Access Issue','Monitoring Tool Issue','DR Issue'],10),
      field('AFFECTED_COMPONENTS','Affected Components','dropdown',false,'',['Application','Infrastructure','User Access'],20),
      field('SERVICES_AFFECTED','Services Affected','dropdown',false,'',['Jenkins Pipeline','Jenkins Batch Job','Palo Alto Firewall','SIEM Tool','IAM','Bastion Host','Cloud Watch','Monitoring Tools','Reports'],30),
      ...COMMON_INCIDENT_FIELDS
    ],
    defaultWorkflow:'WF_INC_OPS_L2', defaultPath:'PATH_INC_OPS_STANDARD'
  },
  {
    symbol:'INC_INF', family:'INC', key:'INFRASTRUCTURE', name:'Infrastructure', aliases:['Infrastructure Incident'], description:'Infrastructure incidents affecting cloud, compute, network, security appliances, database, CI/CD, monitoring, connectivity, and related services.', displayOrder:40,
    fieldsConfig:{ severity:true, priority:false, product:false, module:false, region:false, environment:true },
    customFields:[
      field('INCIDENT_SUBTYPE','Incident Subtype','dropdown',false,'',['VM Down','Monitoring Tool Down','Network Firewall Down','SIEM Tool Down','AWS Service Down','EKS Down','RDS Down','Infrastructure Deployment Issue','Jenkins Down','Controller Down','Bastion Host Down','Admin Server Down','VPC Peering Issue','Site-to-Site Tunnel Issue','OS Patching Issue','Network Connectivity Issue'],10),
      field('SERVICES_AFFECTED','Services Affected','dropdown',false,'',['Jenkins','Palo Alto Firewall','SIEM Tool','IAM','Bastion Host','Cloud Watch','Monitoring Tools','VPC Peering','ELB Service','WAF Service','Route 53'],20),
      ...COMMON_INCIDENT_FIELDS
    ],
    defaultWorkflow:'WF_INC_INF_L2', defaultPath:'PATH_INC_INF_STANDARD'
  }
];

const SERVICE_REQUEST_TYPES = [
  {
    symbol:'SR_APP_ACCESS', family:'SR', key:'APPLICATION_USER_ACCESS', name:'Application User Access & Business Configuration', aliases:['Application User Access and Business Configuration'], description:'Application user access create/modify/delete and Bank business-configuration requests.', displayOrder:10,
    fieldsConfig:{ severity:false, priority:true, product:false, module:false, region:false, environment:true },
    customFields:[
      field('APPLICATION_USERNAME','Application Username','short_text',false,'User name in Active Directory.',[],10),
      field('DEPARTMENT','Department','short_text',false,'Working department.',[],20),
      field('PRIVILEGES','Privileges','long_text',false,'Privileges to be provided or changed.',[],30),
      field('PURPOSE','Purpose','dropdown',false,'Purpose of access/configuration request.',['Create Access','Update Access','Delete Access','Business Configuration Change'],40),
      field('REASON','Reason','long_text',false,'Reason for create/update/delete/configuration change.',[],50),
      field('APPROVER','Approver','short_text',false,'Department/business approver.',[],60)
    ],
    defaultWorkflow:'WF_SR_L1_BANK', defaultPath:'PATH_SR_APP_ACCESS'
  },
  {
    symbol:'SR_AWS_ACCESS', family:'SR', key:'AWS_USER_ACCESS', name:'AWS User Access', aliases:['AWS User Access create, modify, Delete'], description:'AWS IAM user access create, update, and delete requests.', displayOrder:20,
    fieldsConfig:{ severity:false, priority:true, product:false, module:false, region:false, environment:true },
    customFields:[field('AWS_IAM_USERNAME','AWS IAM Username','short_text',false,'User name in AWS.',[],10),field('DEPARTMENT','Department','short_text',false,'Working department.',[],20),field('ACCOUNT','AWS Account','short_text',false,'AWS account number or account identifier.',[],30),field('PRIVILEGES','Privileges','long_text',false,'Privileges requested or currently held.',[],40),field('PURPOSE','Purpose','dropdown',false,'',['Create Access','Update Access','Delete Access'],50),field('REASON','Reason','long_text',false,'Reason for the access change.',[],60),field('APPROVER','Approver','short_text',false,'Department approver.',[],70)],
    defaultWorkflow:'WF_SR_L3_SUNTEC', defaultPath:'PATH_SR_SUNTEC_ACCESS'
  },
  {
    symbol:'SR_BASTION', family:'SR', key:'BASTION_HOST_ACCESS', name:'Bastion Host Access', aliases:['Bastion Access'], description:'Bastion host user access create, modify, and delete requests.', displayOrder:30,
    fieldsConfig:{ severity:false, priority:true, product:false, module:false, region:false, environment:true }, customFields:[], defaultWorkflow:'WF_SR_L3_SUNTEC', defaultPath:'PATH_SR_SUNTEC_ACCESS'
  },
  {
    symbol:'SR_JENKINS', family:'SR', key:'JENKINS_ACCESS', name:'Jenkins Access', aliases:['Jenkins Access Create,Modify ,Delete'], description:'Jenkins access create, modify, and delete requests.', displayOrder:40,
    fieldsConfig:{ severity:false, priority:true, product:false, module:false, region:false, environment:true }, customFields:[], defaultWorkflow:'WF_SR_L3_SUNTEC', defaultPath:'PATH_SR_SUNTEC_ACCESS'
  },
  {
    symbol:'SR_JIRA', family:'SR', key:'JIRA_ACCESS', name:'JIRA Access', aliases:['JIRA Access create,modify,delete'], description:'JIRA access create, modify, and delete requests.', displayOrder:50,
    fieldsConfig:{ severity:false, priority:true, product:false, module:false, region:false, environment:true }, customFields:[], defaultWorkflow:'WF_SR_L3_SUNTEC', defaultPath:'PATH_SR_SUNTEC_ACCESS'
  },
  {
    symbol:'SR_EMAIL', family:'SR', key:'EMAIL_ACCESS', name:'Email Access', aliases:['Email Access Create,Modify,Delete'], description:'Email access or identity create, modify, and delete requests.', displayOrder:60,
    fieldsConfig:{ severity:false, priority:true, product:false, module:false, region:false, environment:true }, customFields:[], defaultWorkflow:'WF_SR_L3_SUNTEC', defaultPath:'PATH_SR_SUNTEC_ACCESS'
  },
  {
    symbol:'SR_FEDERATED', family:'SR', key:'FEDERATED_ACCESS', name:'Federated Access', aliases:[], description:'Federated access requests following the standard controlled access approval workflow.', displayOrder:70,
    fieldsConfig:{ severity:false, priority:true, product:false, module:false, region:false, environment:true }, customFields:[], defaultWorkflow:'WF_SR_L3_SUNTEC', defaultPath:'PATH_SR_SUNTEC_ACCESS'
  },
  {
    symbol:'SR_PRIVILEGED', family:'SR', key:'PRIVILEGED_ACCESS', name:'Privileged Access', aliases:['Privileged Access create,Modify','Privilege Account Access Management'], description:'Time-bound privileged account access with mandatory approval and revocation before closure.', displayOrder:80,
    fieldsConfig:{ severity:false, priority:true, product:false, module:false, region:false, environment:true },
    customFields:[field('AWS_IAM_USERNAME','AWS IAM Username','short_text',false,'User name in AWS.',[],10),field('DEPARTMENT','Department','short_text',false,'Working department.',[],20),field('ACCOUNT','Account','short_text',false,'Account in which privileged access is required.',[],30),field('PRIVILEGES','Privileges','long_text',false,'Administrative or specialized privileges requested.',[],40),field('BUSINESS_JUSTIFICATION','Business Justification','long_text',true,'Business reason for privileged access.',[],50),field('SCOPE_OF_ACCESS','Scope of Access','long_text',true,'Systems/resources where administrative access is required.',[],60),field('DURATION_HOURS','Duration (Hours)','number',false,'Requested access duration in hours.',[],70),field('DURATION_DAYS','Duration (Days)','number',false,'Requested access duration in days.',[],80),field('APPROVER','Approver','short_text',false,'SaaS CoE Head, SaaS CISO, or Global Support approver.',[],90)],
    defaultWorkflow:'WF_SR_PRIVILEGED', defaultPath:'PATH_SR_PRIVILEGED'
  },
  {
    symbol:'SR_DYNAMIC_REPORTS', family:'SR', key:'DYNAMIC_REPORTS', name:'Dynamic Reports', aliases:[], description:'Dynamic/manual/automated report requests for client or SunTec use.', displayOrder:90,
    fieldsConfig:{ severity:false, priority:true, product:false, module:false, region:false, environment:true }, customFields:[field('REPORT_REQUEST_TYPE','Report Request Type','dropdown',false,'',['Manual Report','Automated Report','Vulnerability Report','Other'],10),field('APPROVER','Approver','short_text',false,'Approval stakeholder.',[],20),field('S3_BUCKET_LINK','S3 Bucket Link','url',false,'Report download link after extraction.',[],30)], defaultWorkflow:'WF_SR_L2_PARTNER', defaultPath:'PATH_SR_PARTNER'
  },
  {
    symbol:'SR_DB_EXTRACT', family:'SR', key:'DB_DATA_CICD', name:'DB Data through CI/CD Pipeline', aliases:['Database Extract through CI/CD Pipeline'], description:'Controlled database extract requests executed through the CI/CD pipeline.', displayOrder:100,
    fieldsConfig:{ severity:false, priority:true, product:false, module:false, region:false, environment:true }, customFields:[field('DATA_REQUIREMENT','Data Requirement','long_text',true,'Describe the required data/extract and business purpose.',[],10),field('APPROVER','Approver','short_text',false,'Approval stakeholder.',[],20),field('S3_BUCKET_LINK','S3 Bucket Link','url',false,'Extract/report download link.',[],30)], defaultWorkflow:'WF_SR_L2_PARTNER', defaultPath:'PATH_SR_PARTNER'
  },
  {
    symbol:'SR_DR_DRILL', family:'SR', key:'DR_DRILL_BCP', name:'DR Drill / BCP', aliases:['DR drill/BCP'], description:'Planned disaster-recovery drill and business-continuity-plan execution request.', displayOrder:110,
    fieldsConfig:{ severity:false, priority:true, product:false, module:false, region:false, environment:true },
    customFields:[field('DR_LOCATION','DR Location','short_text',true,'AWS Region where DR switchover will occur.',[],10),field('DR_INITIATION_DATE','DR Initiation Date','date',true,'Date on which the DR drill starts.',[],20),field('DR_SWITCHOVER_TIME','DR Switchover Time','short_text',false,'Approximate switchover time (for example 2 hours).',[],30),field('DR_DRILL_PERIOD','DR Drill Period (Days)','number',false,'Number of days in DR environment.',[],40),field('PRODUCTION_SWITCHOVER_DATE','Production Switchback Date','date',false,'Planned date to switch back to Production.',[],50),field('S3_BUCKET_LINK','S3 Bucket Link','url',false,'Link to DR/BCP reports after the drill.',[],60)],
    defaultWorkflow:'WF_SR_DR_DRILL', defaultPath:'PATH_SR_DR_DRILL'
  },
  {
    symbol:'SR_ENV_WINDOW', family:'SR', key:'AWS_ENVIRONMENT_WINDOW', name:'Adhoc AWS Environment Start/Stop Time', aliases:['Adhoc AWS client environment start and stop timings'], description:'Temporary extension of non-production AWS environment operating hours, with a maximum requested window of 15 hours.', displayOrder:120,
    fieldsConfig:{ severity:false, priority:true, product:false, module:false, region:false, environment:true }, customFields:[field('START_TIME','Start Time','short_text',true,'24-hour clock, HH:MM.',[],10),field('STOP_TIME','Stop Time','short_text',true,'24-hour clock, HH:MM. Start/stop duration must not exceed 15 hours.',[],20),field('TIME_ZONE','Time Zone','short_text',false,'Timezone for the requested operating window.',[],30),field('REQUEST_CLOSE_DATE','Request Close Date','date',false,'Date after which the schedule must revert to the previous window.',[],40)], defaultWorkflow:'WF_SR_ENV_WINDOW', defaultPath:'PATH_SR_ENV_WINDOW'
  },
  {
    symbol:'SR_DEBUG', family:'SR', key:'DEBUG_LOG_LEVEL', name:'Application Debug Log-Level Change', aliases:['Log level change to Debug Mode for application components'], description:'Temporary DEBUG log-level change for application components, with restoration after the approved period.', displayOrder:130,
    fieldsConfig:{ severity:false, priority:true, product:false, module:false, region:false, environment:true }, customFields:[field('COMPONENTS','Application Components','long_text',true,'Components requiring DEBUG log level (for example PC, UI).',[],10),field('REQUEST_CLOSE_DATE','Request Close Date','date',false,'Approved end date; the source process requires completion within 3 hours after approval.',[],20)], defaultWorkflow:'WF_SR_DEBUG', defaultPath:'PATH_SR_DEBUG'
  },
  {
    symbol:'SR_FIREWALL', family:'SR', key:'FIREWALL_RULE_CHANGE', name:'Firewall Rule Change', aliases:['Firewall Rule changes'], description:'Firewall rule change following the standard controlled access/change approval workflow.', displayOrder:140,
    fieldsConfig:{ severity:false, priority:true, product:false, module:false, region:false, environment:true }, customFields:[], defaultWorkflow:'WF_SR_L3_SUNTEC', defaultPath:'PATH_SR_SUNTEC_ACCESS'
  },
  {
    symbol:'SR_FILE_TRANSFER', family:'SR', key:'AWS_FILE_TRANSFER', name:'File Transfer from AWS Environment', aliases:['File transfer from AWS environment to outside it'], description:'Controlled file transfer from AWS environment to an external destination.', displayOrder:150,
    fieldsConfig:{ severity:false, priority:true, product:false, module:false, region:false, environment:true }, customFields:[], defaultWorkflow:'WF_SR_L3_SUNTEC', defaultPath:'PATH_SR_SUNTEC_ACCESS'
  },
  {
    symbol:'SR_INFRA_CONFIG', family:'SR', key:'INFRA_CONFIG_CHANGE', name:'Infrastructure Configuration Change', aliases:['Infra Configuration changes'], description:'Infrastructure configuration change following the standard controlled approval workflow.', displayOrder:160,
    fieldsConfig:{ severity:false, priority:true, product:false, module:false, region:false, environment:true }, customFields:[], defaultWorkflow:'WF_SR_L3_SUNTEC', defaultPath:'PATH_SR_SUNTEC_ACCESS'
  },
  {
    symbol:'SR_IMAGE_DELETE', family:'SR', key:'APP_CONTAINER_IMAGE_DELETE', name:'Application Container Image Deletion', aliases:['Deletion of Application Container Image'], description:'Controlled deletion of an application container image.', displayOrder:170,
    fieldsConfig:{ severity:false, priority:true, product:false, module:false, region:false, environment:true }, customFields:[], defaultWorkflow:'WF_SR_L3_SUNTEC', defaultPath:'PATH_SR_SUNTEC_ACCESS'
  },
  {
    symbol:'SR_RDS_SNAPSHOT', family:'SR', key:'RDS_SNAPSHOT_CHANGE', name:'RDS Snapshot Change', aliases:['RDS snapshot changes'], description:'Controlled RDS snapshot change following the standard approval workflow.', displayOrder:180,
    fieldsConfig:{ severity:false, priority:true, product:false, module:false, region:false, environment:true }, customFields:[], defaultWorkflow:'WF_SR_L3_SUNTEC', defaultPath:'PATH_SR_SUNTEC_ACCESS'
  }
];

const COMMON_ACCESS_FIELDS = [field('USERNAME','Username','short_text',false,'User name in the target system.',[],10),field('DEPARTMENT','Department','short_text',false,'Working department.',[],20),field('ACCOUNT','Account','short_text',false,'Target account or account identifier.',[],30),field('PRIVILEGES','Privileges','long_text',false,'Privileges to be given or modified.',[],40),field('PURPOSE','Purpose','dropdown',false,'',['Create Access','Update Access','Delete Access'],50),field('REASON','Reason','long_text',false,'Reason for create/update/delete.',[],60),field('APPROVER','Approver','short_text',false,'Department approver.',[],70)];
for (const symbol of ['SR_BASTION','SR_JENKINS','SR_JIRA','SR_EMAIL','SR_FEDERATED','SR_FIREWALL','SR_FILE_TRANSFER','SR_INFRA_CONFIG','SR_IMAGE_DELETE','SR_RDS_SNAPSHOT']) {
  const item = SERVICE_REQUEST_TYPES.find((entry) => entry.symbol === symbol);
  if (item && !item.customFields.length) item.customFields = COMMON_ACCESS_FIELDS.map((entry) => ({ ...entry }));
}

const MAINTENANCE_TYPES = [
  {
    symbol:'MR_SCHEDULED', family:'MR', key:'SCHEDULED_MAINTENANCE', name:'Scheduled Maintenance', aliases:['Scheduled Release'], description:'Planned/scheduled release pack or maintenance activity with mutually agreed timing and approvals.', displayOrder:10,
    fieldsConfig:{ severity:false, priority:true, product:false, module:false, region:false, environment:true }, defaultWorkflow:'WF_MR_RELEASE', defaultPath:'PATH_MR_RELEASE',
    customFields:[field('MAINTENANCE_RELEASE_REQUEST','Maintenance Release Request','dropdown',true,'',['Planned Release','Emergency Release','Proactive Release'],10),field('RELEASE_ID','Release ID','short_text',true,'Release patch ID to be applied.',[],20),field('COMPONENTS','Components','dropdown',true,'',['Application','Infrastructure','Services'],30),field('PURPOSE_OF_PACK','Purpose of Pack','short_text',true,'One-line purpose of the pack.',[],40),field('TEST_CASE_LINK','Test Case Link','url',false,'Link to prior environment test evidence.',[],50),field('DURATION_HOURS','Duration of Patch Application (Hours)','number',true,'Estimated time required to apply the pack.',[],60),field('REQUEST_DUE_DATE','Request Due Date','date',true,'Mutually agreed completion date.',[],70),field('APPROVER','Approver','short_text',false,'Release application approver.',[],80),field('EXCEPTION_APPROVER','Exception Approver','short_text',false,'Alternative approver.',[],90),field('TEST_EXECUTION_LINKS','Test Execution Links','long_text',false,'Links to release test execution reports.',[],100)]
  },
  {
    symbol:'MR_PROACTIVE', family:'MR', key:'PROACTIVE_MAINTENANCE', name:'Proactive Maintenance', aliases:['Proactive Release'], description:'Proactive maintenance such as OS/system patching or cloud component patches.', displayOrder:20,
    fieldsConfig:{ severity:false, priority:true, product:false, module:false, region:false, environment:true }, defaultWorkflow:'WF_MR_RELEASE', defaultPath:'PATH_MR_RELEASE', customFields:[]
  },
  {
    symbol:'MR_EMERGENCY', family:'MR', key:'EMERGENCY_MAINTENANCE', name:'Emergency Maintenance', aliases:['Emergency Release'], description:'Emergency/hotfix maintenance that may proceed immediately with post-implementation approval where required.', displayOrder:30,
    fieldsConfig:{ severity:false, priority:true, product:false, module:false, region:false, environment:true }, defaultWorkflow:'WF_MR_RELEASE', defaultPath:'PATH_MR_RELEASE', customFields:[]
  },
  {
    symbol:'MR_VULN', family:'MR', key:'VULNERABILITY_RUN', name:'Vulnerability Run', aliases:['Vulnerability Scan'], description:'Infrastructure vulnerability scan approval, execution, report review, and publication.', displayOrder:40,
    fieldsConfig:{ severity:false, priority:true, product:false, module:false, region:false, environment:true }, defaultWorkflow:'WF_MR_VULN', defaultPath:'PATH_MR_VULN', customFields:[field('ACTIVITY','Activity','short_text',false,'Infra Vulnerability Scan.',[],10),field('COMPONENTS_SCANNED','Components Scanned','long_text',true,'Infrastructure components included in the vulnerability run.',[],20),field('SCAN_DATE','Date of Scan','date',true,'Scheduled scan date.',[],30),field('REQUEST_DUE_DATE','Request Due Date','date',false,'Expected completion date.',[],40),field('APPROVER','Approver','short_text',false,'Approvers for the scan.',[],50),field('EXCEPTION_APPROVER','Exception Approver','short_text',false,'Alternative approver.',[],60),field('S3_BUCKET_LINK','S3 Bucket Link','url',false,'Vulnerability report link.',[],70)]
  },
  {
    symbol:'MR_PENTEST', family:'MR', key:'PENETRATION_TEST_RUN', name:'Penetration Test Run', aliases:['Penetration Test'], description:'Infrastructure penetration testing with SunTec/SaaS CoE approval and AWS Security coordination.', displayOrder:50,
    fieldsConfig:{ severity:false, priority:true, product:false, module:false, region:false, environment:true }, defaultWorkflow:'WF_MR_PENTEST', defaultPath:'PATH_MR_PENTEST', customFields:[field('ACTIVITY','Activity','short_text',false,'Infra Penetration Test.',[],10),field('COMPONENTS_SCANNED','Components Scanned','long_text',true,'Infrastructure/application components included in the test.',[],20),field('SCAN_DATE','Date of Scan','date',true,'Scheduled penetration-test date.',[],30),field('REQUEST_DUE_DATE','Request Due Date','date',false,'Expected completion date.',[],40),field('APPROVER','Approver','short_text',false,'Approvers for the penetration test.',[],50),field('EXCEPTION_APPROVER','Exception Approver','short_text',false,'Alternative approver.',[],60)]
  },
  {
    symbol:'MR_ACTUAL_DR', family:'MR', key:'ACTUAL_DR', name:'Actual DR', aliases:['Disaster Recovery'], description:'Actual disaster-recovery switchover to the secondary region and controlled production switchback.', displayOrder:60,
    fieldsConfig:{ severity:false, priority:true, product:false, module:false, region:false, environment:true }, defaultWorkflow:'WF_MR_ACTUAL_DR', defaultPath:'PATH_MR_ACTUAL_DR', customFields:[field('ACTIVITY','Activity','short_text',false,'DR Switch over.',[],10),field('DR_LOCATION','DR Location','short_text',true,'AWS Region where DR switchover occurs.',[],20),field('DR_INITIATION_DATE','DR Initiation Date','date',true,'Date of DR switchover.',[],30),field('REASON','Reason','long_text',true,'Reason for the DR switchover.',[],40),field('DR_SWITCHOVER_TIME','DR Switchover Time','short_text',false,'Approximate time to make DR ready.',[],50),field('DR_ACTIVITY_CLOSURE_DATE','DR Activity Closure Date','date',false,'Closure date after successful restoration.',[],60),field('APPROVER','Approver','short_text',false,'Approvers for DR movement.',[],70),field('EXCEPTION_APPROVER','Exception Approver','short_text',false,'Alternative approver.',[],80)]
  }
];
const baseMaintenanceFields = MAINTENANCE_TYPES.find((item)=>item.symbol==='MR_SCHEDULED').customFields;
for (const symbol of ['MR_PROACTIVE','MR_EMERGENCY']) {
  const item=MAINTENANCE_TYPES.find((entry)=>entry.symbol===symbol);
  item.customFields=baseMaintenanceFields.map((entry)=>({ ...entry }));
}
ISSUE_TYPES.push(...SERVICE_REQUEST_TYPES, ...MAINTENANCE_TYPES);

function level(localId,label,ownerSide,slaApplicable,displayOrder,workflowKey) {
  return { localId,label,ownerSide,slaApplicable,displayOrder,workflowKey };
}
function move(localId,actionLabel,fromLevelId,toLevelIds,movementType='sequential',primaryLevelId='',displayOrder=10) {
  const targets=Array.isArray(toLevelIds)?toLevelIds:[toLevelIds];
  return { localId,actionLabel,fromLevelId,toLevelId:targets[0],toLevelIds:targets,primaryLevelId:primaryLevelId||targets[0],movementType,targetStatusBehavior:'start',commentRequired:true,reasonRequired:true,displayOrder };
}

const SUPPORT_PATHS = [
  { key:'PATH_TKT_INC', name:'Ticket Incident – Standard Product Support Path', description:'Regular support Incident path: Customer L1 → Partner L2 → SunTec L3, with configurable return routing for clarification, deployment and verification.', levels:[level('L1','L1 · Customer / Bank','client',false,10,'WF_TKT_INC_L1'),level('L2','L2 · Partner Support','partner',false,20,'WF_TKT_INC_L2'),level('L3','L3 · SunTec Product Support','suntec',true,30,'WF_TKT_INC_L3')], movementRules:[move('tkt_inc_l1_l2','Send to Partner L2','L1','L2','sequential','L2',10),move('tkt_inc_l2_l1','Send back to Customer','L2','L1','sequential','L1',15),move('tkt_inc_l2_l3','Escalate to SunTec L3','L2','L3','sequential','L3',20),move('tkt_inc_l3_l2','Return to Partner L2','L3','L2','sequential','L2',25),move('tkt_inc_l3_l1','Send to Customer','L3','L1','sequential','L1',30)] },
  { key:'PATH_TKT_SR', name:'Ticket Service Request – Standard Fulfilment Path', description:'Regular support Service Request path from Customer L1 through Partner L2 and optional SunTec L3 fulfilment, with configurable send-back routing.', levels:[level('L1','L1 · Customer / Bank','client',false,10,'WF_TKT_SR_L1'),level('L2','L2 · Partner Support','partner',false,20,'WF_TKT_SR_L2'),level('L3','L3 · SunTec Product Support','suntec',false,30,'WF_TKT_SR_L3')], movementRules:[move('tkt_sr_l1_l2','Send to Partner L2','L1','L2','sequential','L2',10),move('tkt_sr_l2_l1','Send back to Customer','L2','L1','sequential','L1',15),move('tkt_sr_l2_l3','Send to SunTec L3','L2','L3','sequential','L3',20),move('tkt_sr_l3_l2','Return to Partner L2','L3','L2','sequential','L2',25),move('tkt_sr_l3_l1','Send to Customer','L3','L1','sequential','L1',30)] },
  { key:'PATH_TKT_CR', name:'Ticket Change Request – Controlled Change Path', description:'Regular support Change Request path with Customer L1, Partner L2 and optional SunTec L3 involvement plus return routing.', levels:[level('L1','L1 · Customer / Bank','client',false,10,'WF_TKT_CR_L1'),level('L2','L2 · Partner Support','partner',false,20,'WF_TKT_CR_L2'),level('L3','L3 · SunTec Product Support','suntec',false,30,'WF_TKT_CR_L3')], movementRules:[move('tkt_cr_l1_l2','Send to Partner L2','L1','L2','sequential','L2',10),move('tkt_cr_l2_l1','Send back to Customer','L2','L1','sequential','L1',15),move('tkt_cr_l2_l3','Send to SunTec L3','L2','L3','sequential','L3',20),move('tkt_cr_l3_l2','Return to Partner L2','L3','L2','sequential','L2',25),move('tkt_cr_l3_l1','Send to Customer','L3','L1','sequential','L1',30)] },
  { key:'PATH_TKT_QUERY', name:'Ticket Query – Straightforward Response Path', description:'Simple query path: assign, clarify if needed, provide response, and close.', levels:[level('L1','L1 · Client Help Desk','client',false,10,'WF_TKT_QUERY')], movementRules:[] },
  {
    key:'PATH_INC_APP_STANDARD', name:'Application Incident – Standard Support Path', aliases:['Standard Application Incident Path','Application Incident Standard Path'], description:'L1 Bank triage followed by Partner L2 and SunTec L3 escalation when required.',
    levels:[level('L1','L1 · Bank','client',false,10,'WF_INC_APP_L1'),level('L2','L2 · Partner','partner',true,20,'WF_INC_APP_L2'),level('L3','L3 · SunTec Support','suntec',true,30,'WF_INC_APP_L3')],
    movementRules:[move('app_l1_l2','Send to Partner L2','L1','L2','sequential','L2',10),move('app_l2_l1','Send back to Bank','L2','L1','sequential','L1',15),move('app_l2_l3','Escalate to SunTec L3','L2','L3','sequential','L3',20),move('app_l3_l2','Return to Partner L2','L3','L2','sequential','L2',25),move('app_l3_l1','Send to Bank','L3','L1','sequential','L1',30)]
  },
  {
    key:'PATH_INC_APP_PARALLEL', name:'Application Incident – L2 + L3 Parallel Support Path', aliases:['Application Incident – Critical Parallel','Application Incident Critical Parallel Path'], description:'L1 Bank triage followed by simultaneous Partner L2 and SunTec L3 work, with L2 primary.',
    levels:[level('L1','L1 · Bank','client',false,10,'WF_INC_APP_L1'),level('L2','L2 · Partner','partner',true,20,'WF_INC_APP_L2'),level('L3','L3 · SunTec Support','suntec',true,30,'WF_INC_APP_L3')],
    movementRules:[move('app_l1_parallel','Start L2 + L3','L1',['L2','L3'],'parallel','L2',10),move('app_l2_l1','Send back to Bank','L2','L1','sequential','L1',15),move('app_l2_l3','Escalate to SunTec L3','L2','L3','sequential','L3',20),move('app_l3_l2','Return to Partner L2','L3','L2','sequential','L2',25),move('app_l3_l1','Send to Bank','L3','L1','sequential','L1',30)]
  },
  {
    key:'PATH_INC_SEC_STANDARD', name:'Security Incident – Partner to SunTec', aliases:['Security Incident Standard Path'], description:'Partner L2 security response with escalation to SunTec L3 when required.',
    levels:[level('L2','L2 · Partner Security','partner',true,10,'WF_INC_SEC_L2'),level('L3','L3 · SunTec Security','suntec',true,20,'WF_INC_SEC_L3')], movementRules:[move('sec_l2_l3','Escalate to SunTec L3','L2','L3','sequential','L3',10),move('sec_l3_l2','Return to Partner L2','L3','L2','sequential','L2',20)]
  },
  {
    key:'PATH_INC_OPS_STANDARD', name:'Operational Incident – Partner to SunTec', aliases:['Operational Incident Standard Path'], description:'Partner L2 operational response with escalation to SunTec L3 when required.',
    levels:[level('L2','L2 · Partner Operations','partner',true,10,'WF_INC_OPS_L2'),level('L3','L3 · SunTec Operations','suntec',true,20,'WF_INC_OPS_L3')], movementRules:[move('ops_l2_l3','Escalate to SunTec L3','L2','L3','sequential','L3',10),move('ops_l3_l2','Return to Partner L2','L3','L2','sequential','L2',20)]
  },
  {
    key:'PATH_INC_INF_STANDARD', name:'Infrastructure Incident – Partner to SunTec', aliases:['Infrastructure Incident Standard Path'], description:'Partner L2 infrastructure response with escalation to SunTec L3 or vendor coordination when required.',
    levels:[level('L2','L2 · Partner Infrastructure','partner',true,10,'WF_INC_INF_L2'),level('L3','L3 · SunTec Infrastructure','suntec',true,20,'WF_INC_INF_L3')], movementRules:[move('inf_l2_l3','Escalate to SunTec L3','L2','L3','sequential','L3',10),move('inf_l3_l2','Return to Partner L2','L3','L2','sequential','L2',20)]
  },
  {
    key:'PATH_SR_APP_ACCESS', name:'Service Request – Bank / Partner Application Access', description:'Application access/configuration request that may be fulfilled by Bank L1 or moved between Bank and Partner L2.',
    levels:[level('L1','L1 · Bank','client',false,10,'WF_SR_L1_BANK'),level('L2','L2 · Partner','partner',false,20,'WF_SR_L2_PARTNER')],
    movementRules:[move('sr_app_l1_l2','Send to Partner L2','L1','L2','sequential','L2',10),move('sr_app_l2_l1','Send to Bank L1','L2','L1','sequential','L1',20)]
  },
  {
    key:'PATH_SR_SUNTEC_ACCESS', name:'Service Request – SunTec Access Fulfilment', description:'Access/control requests that may originate at Bank or Partner and are fulfilled by SunTec SaaS CoE.',
    levels:[level('L1','L1 · Bank','client',false,10,'WF_SR_L1_BANK'),level('L2','L2 · Partner','partner',false,20,'WF_SR_L2_PARTNER'),level('L3','L3 · SunTec SaaS CoE','suntec',false,30,'WF_SR_L3_SUNTEC')],
    movementRules:[move('sr_access_l1_l3','Send to SunTec L3','L1','L3','sequential','L3',10),move('sr_access_l2_l1','Send back to Bank','L2','L1','sequential','L1',15),move('sr_access_l2_l3','Send to SunTec L3','L2','L3','sequential','L3',20),move('sr_access_l3_l2','Return to Partner L2','L3','L2','sequential','L2',25),move('sr_access_l3_l1','Send to Bank','L3','L1','sequential','L1',30)]
  },
  {
    key:'PATH_SR_PRIVILEGED', name:'Service Request – Privileged Access', description:'Privileged access requests move to SunTec SaaS CoE for approval, access grant, and mandatory revocation.',
    levels:[level('L1','L1 · Bank','client',false,10,'WF_SR_L1_BANK'),level('L2','L2 · Partner','partner',false,20,'WF_SR_L2_PARTNER'),level('L3','L3 · SunTec Infosec','suntec',false,30,'WF_SR_PRIVILEGED')],
    movementRules:[move('sr_priv_l1_l3','Send to SunTec Infosec','L1','L3','sequential','L3',10),move('sr_priv_l2_l1','Send back to Bank','L2','L1','sequential','L1',15),move('sr_priv_l2_l3','Send to SunTec Infosec','L2','L3','sequential','L3',20),move('sr_priv_l3_l2','Return to Partner L2','L3','L2','sequential','L2',25),move('sr_priv_l3_l1','Send to Bank','L3','L1','sequential','L1',30)]
  },
  {
    key:'PATH_SR_PARTNER', name:'Service Request – Partner Fulfilment', description:'Bank-originated service request fulfilled by Partner L2.',
    levels:[level('L1','L1 · Bank','client',false,10,'WF_SR_L1_BANK'),level('L2','L2 · Partner','partner',false,20,'WF_SR_L2_PARTNER')], movementRules:[move('sr_partner_l1_l2','Send to Partner L2','L1','L2','sequential','L2',10),move('sr_partner_l2_l1','Send back to Bank','L2','L1','sequential','L1',20)]
  },
  {
    key:'PATH_SR_DR_DRILL', name:'Service Request – DR Drill / BCP', description:'Partner L2 DR drill and BCP execution path.',
    levels:[level('L2','L2 · Partner DR Operations','partner',false,10,'WF_SR_DR_DRILL')], movementRules:[]
  },
  {
    key:'PATH_SR_ENV_WINDOW', name:'Service Request – AWS Environment Window', description:'SunTec Operations path for temporary non-production environment schedule changes.',
    levels:[level('L2','L2 · SunTec Operations','suntec',false,10,'WF_SR_ENV_WINDOW'),level('L3','L3 · SunTec Support','suntec',false,20,'WF_SR_ENV_WINDOW')], movementRules:[move('sr_env_l2_l3','Escalate within SunTec','L2','L3','sequential','L3',10),move('sr_env_l3_l2','Return to SunTec Operations L2','L3','L2','sequential','L2',20)]
  },
  {
    key:'PATH_SR_DEBUG', name:'Service Request – Debug Log Level', description:'SunTec Operations L2 path for temporary DEBUG log-level changes.',
    levels:[level('L2','L2 · SunTec Operations','suntec',false,10,'WF_SR_DEBUG')], movementRules:[]
  },
  {
    key:'PATH_MR_RELEASE', name:'Maintenance – Release Application Path', description:'Partner L2 maintenance release application path.', levels:[level('L2','L2 · Partner DevOps','partner',false,10,'WF_MR_RELEASE')], movementRules:[]
  },
  {
    key:'PATH_MR_ACTUAL_DR', name:'Maintenance – Actual DR Path', description:'Partner L2 actual disaster-recovery switchover path.', levels:[level('L2','L2 · Partner DR Operations','partner',false,10,'WF_MR_ACTUAL_DR')], movementRules:[]
  },
  {
    key:'PATH_MR_VULN', name:'Maintenance – Vulnerability Run Path', description:'Partner L2 infrastructure vulnerability run path.', levels:[level('L2','L2 · Partner Security Operations','partner',false,10,'WF_MR_VULN')], movementRules:[]
  },
  {
    key:'PATH_MR_PENTEST', name:'Maintenance – Penetration Test Path', description:'Partner L2 infrastructure penetration test path.', levels:[level('L2','L2 · Partner Security Operations','partner',false,10,'WF_MR_PENTEST')], movementRules:[]
  }
];

const SLA_DEFINITIONS = [
  {
    symbol:'sample', applicableIssueLevelCodes:['L2','L3'], applicableEnvironmentCodes:['PROD','DR'], key:'SLA_XELERATE_SAMPLE_INCIDENT', name:'Xelerate SaaS Sample Incident SLA', description:'Sample incident SLA matrix from the Xelerate SaaS Incident Process Workflow; actual client SLA should follow the applicable SOW.', supportWindow:'mixed', clockStartTrigger:'severity_selected',
    rules:[
      { code:'S1',responseTimeValue:30,responseTimeUnit:'minutes',resolutionTimeValue:24,resolutionTimeUnit:'hours',updateFrequencyValue:60,updateFrequencyUnit:'minutes',clockType:'calendar',notes:'Critical sample SLA.' },
      { code:'S2',responseTimeValue:1,responseTimeUnit:'business_hours',resolutionTimeValue:3,resolutionTimeUnit:'days',updateFrequencyValue:60,updateFrequencyUnit:'minutes',clockType:'working_hours',notes:'High sample SLA.' },
      { code:'S3',responseTimeValue:4,responseTimeUnit:'business_hours',resolutionTimeValue:5,resolutionTimeUnit:'days',updateFrequencyValue:8,updateFrequencyUnit:'hours',clockType:'working_hours',notes:'Medium sample SLA.' },
      { code:'S4',responseTimeValue:9,responseTimeUnit:'business_hours',resolutionTimeValue:10,resolutionTimeUnit:'days',updateFrequencyValue:2,updateFrequencyUnit:'days',clockType:'working_hours',notes:'Low sample SLA.' }
    ]
  },
  {
    symbol:'silver', applicableIssueLevelCodes:['L3'], applicableEnvironmentCodes:['PROD','DR'], key:'SLA_SUNTEC_SILVER', name:'Silver – Standard SLA', description:'SunTec Silver standard support SLA.', supportWindow:'business_hours', clockStartTrigger:'severity_selected',
    rules:[
      { code:'S1',responseTimeValue:2,responseTimeUnit:'business_hours',resolutionTimeValue:48,resolutionTimeUnit:'hours',updateFrequencyValue:1,updateFrequencyUnit:'daily',clockType:'working_hours',notes:'Daily status update.' },
      { code:'S2',responseTimeValue:4,responseTimeUnit:'business_hours',resolutionTimeValue:96,resolutionTimeUnit:'hours',updateFrequencyValue:1,updateFrequencyUnit:'daily',clockType:'working_hours',notes:'Daily status update.' },
      { code:'S3',responseTimeValue:3,responseTimeUnit:'business_days',resolutionTimeValue:12,resolutionTimeUnit:'business_days',updateFrequencyValue:null,updateFrequencyUnit:'periodic',clockType:'working_hours',notes:'Through periodic project update.' },
      { code:'S4',responseTimeValue:10,responseTimeUnit:'business_days',resolutionTimeValue:null,resolutionTimeUnit:'none',updateFrequencyValue:null,updateFrequencyUnit:'periodic',clockType:'working_hours',notes:'Resolution not committed; periodic project update.' }
    ]
  },
  {
    symbol:'gold', applicableIssueLevelCodes:['L3'], applicableEnvironmentCodes:['PROD','DR'], key:'SLA_SUNTEC_GOLD', name:'Gold – Expedited SLA', description:'SunTec Gold expedited support SLA; support window includes 24x7 attention for S1.', supportWindow:'mixed', clockStartTrigger:'severity_selected',
    rules:[
      { code:'S1',responseTimeValue:1,responseTimeUnit:'hours',resolutionTimeValue:24,resolutionTimeUnit:'hours',updateFrequencyValue:4,updateFrequencyUnit:'hours',clockType:'calendar',notes:'Every 4 hours, if required.' },
      { code:'S2',responseTimeValue:2,responseTimeUnit:'business_hours',resolutionTimeValue:72,resolutionTimeUnit:'hours',updateFrequencyValue:1,updateFrequencyUnit:'daily',clockType:'working_hours',notes:'Daily status update.' },
      { code:'S3',responseTimeValue:2,responseTimeUnit:'business_days',resolutionTimeValue:10,resolutionTimeUnit:'business_days',updateFrequencyValue:null,updateFrequencyUnit:'periodic',clockType:'working_hours',notes:'Through periodic project update.' },
      { code:'S4',responseTimeValue:8,responseTimeUnit:'business_days',resolutionTimeValue:null,resolutionTimeUnit:'none',updateFrequencyValue:null,updateFrequencyUnit:'periodic',clockType:'working_hours',notes:'Resolution not committed; periodic project update.' }
    ]
  },
  {
    symbol:'platinum', applicableIssueLevelCodes:['L3'], applicableEnvironmentCodes:['PROD','DR'], key:'SLA_SUNTEC_PLATINUM', name:'Platinum – Expedited SLA', description:'SunTec Platinum expedited support SLA; support window includes 24x7 attention for S1 and S2.', supportWindow:'mixed', clockStartTrigger:'severity_selected',
    rules:[
      { code:'S1',responseTimeValue:0.5,responseTimeUnit:'hours',resolutionTimeValue:12,resolutionTimeUnit:'hours',updateFrequencyValue:2,updateFrequencyUnit:'hours',clockType:'calendar',notes:'Every 2 hours, if required.' },
      { code:'S2',responseTimeValue:1,responseTimeUnit:'hours',resolutionTimeValue:48,resolutionTimeUnit:'hours',updateFrequencyValue:2,updateFrequencyUnit:'twice_daily',clockType:'calendar',notes:'Twice a day.' },
      { code:'S3',responseTimeValue:1,responseTimeUnit:'business_days',resolutionTimeValue:8,resolutionTimeUnit:'business_days',updateFrequencyValue:null,updateFrequencyUnit:'periodic',clockType:'working_hours',notes:'Through periodic project update.' },
      { code:'S4',responseTimeValue:6,responseTimeUnit:'business_days',resolutionTimeValue:null,resolutionTimeUnit:'none',updateFrequencyValue:null,updateFrequencyUnit:'periodic',clockType:'working_hours',notes:'Resolution not committed; periodic project update.' }
    ]
  }
];

function validateCatalog() {
  const errors=[];
  const unique=(items,label,selector)=>{ const seen=new Set(); for(const item of items){ const key=selector(item); if(seen.has(key)) errors.push(`${label}: duplicate ${key}`); seen.add(key);} };
  unique(WORKFLOWS,'Workflow key',(x)=>x.key);
  unique(SUPPORT_PATHS,'Support path key',(x)=>x.key);
  unique(ISSUE_FAMILIES,'Issue family symbol',(x)=>x.symbol);
  unique(ISSUE_TYPES,'Issue type symbol',(x)=>x.symbol);
  unique(SLA_DEFINITIONS,'SLA symbol',(x)=>x.symbol);
  const wfKeys=new Set(WORKFLOWS.map((x)=>x.key));
  const pathKeys=new Set(SUPPORT_PATHS.map((x)=>x.key));
  const familySymbols=new Set(ISSUE_FAMILIES.map((x)=>x.symbol));
  for(const wf of WORKFLOWS){
    const statusIds=new Set();
    const taskIds=new Set();
    for(const status of wf.statuses){
      if(statusIds.has(status.localId)) errors.push(`${wf.name}: duplicate status localId ${status.localId}`);
      statusIds.add(status.localId);
      for(const t of status.taskTemplates||[]){
        if(taskIds.has(t.localId)) errors.push(`${wf.name}: duplicate task localId ${t.localId}`);
        taskIds.add(t.localId);
      }
    }
    for(const edge of wf.transitions){
      if(!statusIds.has(edge.fromStatusId)||!statusIds.has(edge.toStatusId)) errors.push(`${wf.name}: transition ${edge.fromStatusId} -> ${edge.toStatusId} references missing status`);
      if(edge.fromStatusId===edge.toStatusId) errors.push(`${wf.name}: self transition ${edge.fromStatusId}`);
    }
  }
  for(const pathDef of SUPPORT_PATHS){
    for(const lvl of pathDef.levels) if(!wfKeys.has(lvl.workflowKey)) errors.push(`${pathDef.name}: missing workflow ${lvl.workflowKey}`);
    const levelIds=new Set(pathDef.levels.map((x)=>x.localId));
    for(const rule of pathDef.movementRules){
      if(!levelIds.has(rule.fromLevelId)) errors.push(`${pathDef.name}: movement ${rule.localId} source ${rule.fromLevelId} missing`);
      for(const target of rule.toLevelIds||[rule.toLevelId]) if(!levelIds.has(target)) errors.push(`${pathDef.name}: movement ${rule.localId} target ${target} missing`);
    }
  }
  for(const typeDef of ISSUE_TYPES){
    if(!familySymbols.has(typeDef.family)) errors.push(`${typeDef.name}: family ${typeDef.family} missing`);
    if(!wfKeys.has(typeDef.defaultWorkflow)) errors.push(`${typeDef.name}: workflow ${typeDef.defaultWorkflow} missing`);
    if(!pathKeys.has(typeDef.defaultPath)) errors.push(`${typeDef.name}: support path ${typeDef.defaultPath} missing`);
    const fieldKeys=new Set();
    for(const f of typeDef.customFields||[]){
      if(fieldKeys.has(f.fieldKey)) errors.push(`${typeDef.name}: duplicate field ${f.fieldKey}`);
      fieldKeys.add(f.fieldKey);
      if(String(f.optionsText||'').length>1200) errors.push(`${typeDef.name}/${f.fieldKey}: options exceed schema length`);
    }
  }
  if(errors.length) throw new Error(`Provisioning catalogue validation failed:\n- ${errors.join('\n- ')}`);
}

async function chooseOrganization(selector) {
  const organizations=await Organization.find({ status:'active' }).sort({name:1});
  if(!organizations.length) throw new Error('No active organization exists. Create and activate the organization first.');
  const target=canonical(selector);
  const matches=organizations.filter((item)=>[String(item._id),item.shortCode,item.workspaceSlug,item.name].some((value)=>canonical(value)===target));
  if(matches.length===1) return matches[0];
  if(!matches.length) throw new Error(`Organization not found: ${selector}`);
  throw new Error(`Organization selector is ambiguous: ${selector}`);
}

async function chooseClient(organizationId, selector) {
  if(!selector) return null;
  const clients=await Client.find({ organizationId }).sort({name:1});
  const target=canonical(selector);
  const matches=clients.filter((item)=>[String(item._id),item.shortCode,item.name].some((value)=>canonical(value)===target));
  if(matches.length===1) return matches[0];
  if(!matches.length) return null;
  throw new Error(`Client selector is ambiguous: ${selector}`);
}

async function saveIfNeeded(doc, changed, apply) {
  if(changed && apply) await doc.save();
  return doc;
}

function assignScalar(doc, fieldName, value) {
  const before=plain(doc[fieldName]);
  const after=plain(value);
  if(isSame(before,after)) return false;
  doc[fieldName]=value;
  return true;
}

async function ensureSeverity(org, def, options) {
  let doc=await Severity.findOne({ organizationId:org._id, code:def.code });
  if(!doc){
    doc=new Severity({ organizationId:org._id, ...def, status:'active' });
    record('create','Severity',def.code,def.name);
    if(options.apply) await doc.save();
    return doc;
  }
  let changed=false;
  for(const key of ['name','description','marker','displayOrder','status']) changed=assignScalar(doc,key,key==='status'?'active':def[key])||changed;
  record(changed?'update':'unchanged','Severity',def.code,def.name);
  return saveIfNeeded(doc,changed,options.apply);
}

async function ensurePriority(org, def, options) {
  let doc=await Priority.findOne({ organizationId:org._id, code:def.code });
  if(!doc){ doc=new Priority({organizationId:org._id,...def,status:'active'}); record('create','Priority',def.code,def.name); if(options.apply) await doc.save(); return doc; }
  let changed=false; for(const key of ['name','description','marker','displayOrder','status']) changed=assignScalar(doc,key,key==='status'?'active':def[key])||changed;
  record(changed?'update':'unchanged','Priority',def.code,def.name); return saveIfNeeded(doc,changed,options.apply);
}

async function ensureEnvironment(org, def, options) {
  const codeCandidates=[def.code,...(def.aliases||[])].map((x)=>String(x).toUpperCase());
  let doc=await Environment.findOne({ organizationId:org._id, code:{ $in:codeCandidates } });
  if(!doc) doc=await Environment.findOne({ organizationId:org._id, name:{ $regex:`^${def.name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}$`, $options:'i' } });
  if(!doc){
    doc=new Environment({ organizationId:org._id, code:def.code, name:def.name, description:def.description, environmentType:def.environmentType, slaApplicableByDefault:def.slaApplicableByDefault, displayOrder:def.displayOrder, status:'active' });
    record('create','Environment',def.code,def.name); if(options.apply) await doc.save(); return doc;
  }
  let changed=false;
  for(const [key,value] of Object.entries({ name:def.name, description:def.description, environmentType:def.environmentType, slaApplicableByDefault:def.slaApplicableByDefault, displayOrder:def.displayOrder, status:'active' })) changed=assignScalar(doc,key,value)||changed;
  record(changed?'update':'unchanged','Environment',doc.code,def.name); return saveIfNeeded(doc,changed,options.apply);
}

function mergeCustomFields(existingFields=[], desiredFields=[]) {
  const next=(existingFields||[]).map(plain);
  let changed=false;
  for(const desired of desiredFields){
    let existing=next.find((item)=>String(item.fieldKey||'').toUpperCase()===desired.fieldKey);
    if(!existing){ next.push({ ...desired }); changed=true; continue; }
    for(const [key,value] of Object.entries(desired)){
      if(!isSame(existing[key],value)){ existing[key]=value; changed=true; }
    }
  }
  next.sort((a,b)=>Number(a.displayOrder||100)-Number(b.displayOrder||100)||String(a.label).localeCompare(String(b.label)));
  return { next, changed };
}

async function ensureFamily(org, def, options) {
  const aliasSet=new Set([def.name,...(def.aliases||[])].map(canonical));
  let doc=await IssueType.findOne({ organizationId:org._id, level:1, key:def.key });
  if(!doc){
    const candidates=await IssueType.find({organizationId:org._id,level:1});
    doc=candidates.find((item)=>aliasSet.has(canonical(item.name)))||null;
  }
  if(!doc){
    doc=new IssueType({ organizationId:org._id, level:1, parentTypeId:null, name:def.name, key:def.key, description:def.description, icon:def.icon, displayOrder:def.displayOrder, status:'active', fieldsConfig:{severity:true,priority:true,product:true,module:true,region:true,environment:true}, customFields:[] });
    record('create','Issue family',def.key,def.name); if(options.apply) await doc.save(); return doc;
  }
  let changed=false;
  for(const [key,value] of Object.entries({ name:def.name, key:def.key, description:def.description, icon:def.icon, displayOrder:def.displayOrder, status:'active' })) changed=assignScalar(doc,key,value)||changed;
  record(changed?'update':'unchanged','Issue family',doc.key,doc.name); return saveIfNeeded(doc,changed,options.apply);
}

async function ensureIssueType(org, familyDoc, def, workflowDoc, pathDoc, options) {
  const aliasSet=new Set([def.name,...(def.aliases||[])].map(canonical));
  let doc=await IssueType.findOne({ organizationId:org._id, level:2, parentTypeId:familyDoc._id, key:def.key });
  if(!doc){
    const candidates=await IssueType.find({organizationId:org._id,level:2,parentTypeId:familyDoc._id});
    doc=candidates.find((item)=>aliasSet.has(canonical(item.name)))||null;
  }
  if(!doc){
    doc=new IssueType({ organizationId:org._id, level:2, parentTypeId:familyDoc._id, name:def.name, key:def.key, description:def.description, icon:'•', displayOrder:def.displayOrder, status:'active', fieldsConfig:def.fieldsConfig, customFields:def.customFields, workflowId:workflowDoc?._id||null, supportPathId:pathDoc?._id||null });
    record('create','Request subtype',def.key,`${familyDoc.name} / ${def.name}`); if(options.apply) await doc.save(); return doc;
  }
  let changed=false;
  for(const [key,value] of Object.entries({ description:def.description, displayOrder:def.displayOrder, status:'active', fieldsConfig:def.fieldsConfig, workflowId:workflowDoc?._id||null, supportPathId:pathDoc?._id||null })) changed=assignScalar(doc,key,value)||changed;
  const merged=mergeCustomFields(doc.customFields||[],def.customFields||[]); if(merged.changed){ doc.customFields=merged.next; changed=true; }
  record(changed?'update':'unchanged','Request subtype',doc.key,`${familyDoc.name} / ${doc.name}`); return saveIfNeeded(doc,changed,options.apply);
}

function mergeTasks(existingTasks=[], desiredTasks=[]) {
  const next=(existingTasks||[]).map(plain);
  let changed=false;
  for(const desired of desiredTasks){
    let existing=next.find((item)=>item.localId===desired.localId)||next.find((item)=>canonical(item.title)===canonical(desired.title));
    if(!existing){ next.push({ ...desired }); changed=true; continue; }
    // Preserve an existing localId when the task was adopted by title.
    const stableLocalId=existing.localId||desired.localId;
    for(const [key,value] of Object.entries(desired)){
      if(key==='localId') continue;
      if(!isSame(existing[key],value)){ existing[key]=value; changed=true; }
    }
    existing.localId=stableLocalId;
  }
  next.sort((a,b)=>Number(a.displayOrder||100)-Number(b.displayOrder||100)||String(a.title).localeCompare(String(b.title)));
  return { next, changed };
}

async function ensureWorkflow(org, def, options) {
  let doc=await Workflow.findOne({ organizationId:org._id, key:def.key });
  if(!doc) doc=await Workflow.findOne({ organizationId:org._id, name:def.name });
  if(!doc){
    doc=new Workflow({ organizationId:org._id, name:def.name, key:def.key, description:def.description, statuses:def.statuses, transitions:def.transitions, status:'active' });
    record('create','Workflow',def.key,def.name); if(options.apply) await doc.save(); return doc;
  }

  let changed=false;
  changed=assignScalar(doc,'name',def.name)||changed;
  changed=assignScalar(doc,'description',def.description)||changed;
  changed=assignScalar(doc,'status','active')||changed;
  const nextStatuses=(doc.statuses||[]).map(plain);
  const desiredToActual=new Map();
  const usedIds=new Set(nextStatuses.map((item)=>item.localId));
  for(const desired of def.statuses){
    let existing=nextStatuses.find((item)=>item.localId===desired.localId)||nextStatuses.find((item)=>canonical(item.name)===canonical(desired.name));
    if(!existing){
      let actualId=desired.localId; let suffix=2; while(usedIds.has(actualId)){ actualId=`${desired.localId}_${suffix}`.slice(0,40); suffix+=1; }
      usedIds.add(actualId);
      existing={ ...desired, localId:actualId };
      nextStatuses.push(existing); changed=true;
    } else {
      for(const [key,value] of Object.entries(desired)){
        if(['localId','taskTemplates'].includes(key)) continue;
        if(!isSame(existing[key],value)){ existing[key]=value; changed=true; }
      }
      const mergedTasks=mergeTasks(existing.taskTemplates||[],desired.taskTemplates||[]); if(mergedTasks.changed){ existing.taskTemplates=mergedTasks.next; changed=true; }
    }
    desiredToActual.set(desired.localId,existing.localId);
  }
  nextStatuses.sort((a,b)=>Number(a.displayOrder||100)-Number(b.displayOrder||100)||String(a.name).localeCompare(String(b.name)));
  const nextTransitions=(doc.transitions||[]).map(plain);
  for(const desired of def.transitions){
    const from=desiredToActual.get(desired.fromStatusId)||desired.fromStatusId;
    const to=desiredToActual.get(desired.toStatusId)||desired.toStatusId;
    if(!nextTransitions.some((edge)=>edge.fromStatusId===from&&edge.toStatusId===to)){ nextTransitions.push({fromStatusId:from,toStatusId:to}); changed=true; }
  }
  doc.statuses=nextStatuses; doc.transitions=nextTransitions;
  record(changed?'update':'unchanged','Workflow',doc.key,doc.name); return saveIfNeeded(doc,changed,options.apply);
}

async function ensureSupportPath(org, def, workflowMap, options) {
  let doc=await SupportPath.findOne({ organizationId:org._id, key:def.key });
  if(!doc){
    const aliasSet=new Set([def.name,...(def.aliases||[])].map(canonical));
    const candidates=await SupportPath.find({ organizationId:org._id });
    doc=candidates.find((item)=>aliasSet.has(canonical(item.name)))||null;
  }
  const desiredLevels=def.levels.map((lvl)=>({ ...lvl, workflowId:workflowMap.get(lvl.workflowKey)?._id||null, workflowName:workflowMap.get(lvl.workflowKey)?.name||'', workflowKey:undefined }));
  if(!doc){
    doc=new SupportPath({ organizationId:org._id, name:def.name, key:def.key, description:def.description, status:'active', levels:desiredLevels, movementRules:def.movementRules });
    record('create','Support path',def.key,def.name); if(options.apply) await doc.save(); return doc;
  }
  let changed=false;
  changed=assignScalar(doc,'name',def.name)||changed; changed=assignScalar(doc,'description',def.description)||changed; changed=assignScalar(doc,'status','active')||changed;
  const nextLevels=(doc.levels||[]).map(plain);
  for(const desired of desiredLevels){
    let existing=nextLevels.find((item)=>item.localId===desired.localId);
    if(!existing){ nextLevels.push({ ...desired }); changed=true; continue; }
    for(const [key,value] of Object.entries(desired)){ if(key==='workflowKey') continue; if(!isSame(existing[key],value)){ existing[key]=value; changed=true; } }
  }
  nextLevels.sort((a,b)=>Number(a.displayOrder||100)-Number(b.displayOrder||100));
  const nextRules=(doc.movementRules||[]).map(plain);
  for(const desired of def.movementRules){
    let existing=nextRules.find((item)=>item.localId===desired.localId);
    if(!existing){ nextRules.push({ ...desired }); changed=true; continue; }
    for(const [key,value] of Object.entries(desired)){ if(!isSame(existing[key],value)){ existing[key]=value; changed=true; } }
  }
  nextRules.sort((a,b)=>Number(a.displayOrder||100)-Number(b.displayOrder||100));
  doc.levels=nextLevels; doc.movementRules=nextRules;
  record(changed?'update':'unchanged','Support path',doc.key,doc.name); return saveIfNeeded(doc,changed,options.apply);
}

async function ensureSla(org, def, severityMap, environmentMap, options) {
  let doc=await SlaPolicy.findOne({ organizationId:org._id, key:def.key });
  if(!doc) doc=await SlaPolicy.findOne({ organizationId:org._id, name:def.name });
  const rules=def.rules.map((rule)=>({
    ruleBasis:'severity', severityId:severityMap.get(rule.code)?._id||null, priorityId:null,
    responseTimeValue:rule.responseTimeValue, responseTimeUnit:rule.responseTimeUnit,
    resolutionTimeValue:rule.resolutionTimeValue, resolutionTimeUnit:rule.resolutionTimeUnit,
    updateFrequencyValue:rule.updateFrequencyValue, updateFrequencyUnit:rule.updateFrequencyUnit,
    clockType:rule.clockType, notes:rule.notes
  }));
  const envCodes=def.applicableEnvironmentCodes||['PROD','DR'];
  const levelCodes=def.applicableIssueLevelCodes||['L2','L3'];
  const applicability={ applyOnlyWhenSeveritySelected:true, applicableEnvironmentIds:envCodes.map((code)=>environmentMap.get(code)?._id).filter(Boolean), applicableIssueLevelCodes:levelCodes };
  if(!doc){
    doc=new SlaPolicy({ organizationId:org._id, name:def.name, key:def.key, description:def.description, supportWindow:def.supportWindow, clockStartTrigger:def.clockStartTrigger, rules, applicability, status:'active' });
    record('create','SLA policy',def.key,def.name); if(options.apply) await doc.save(); return doc;
  }
  let changed=false;
  for(const [key,value] of Object.entries({name:def.name,description:def.description,supportWindow:def.supportWindow,clockStartTrigger:def.clockStartTrigger,rules,applicability,status:'active'})) changed=assignScalar(doc,key,value)||changed;
  record(changed?'update':'unchanged','SLA policy',doc.key,doc.name); return saveIfNeeded(doc,changed,options.apply);
}

async function writeBackup(org, client) {
  const dir=path.join(projectRoot,'backups','suntecsds-service-model-provisioning'); await fs.mkdir(dir,{recursive:true});
  const stamp=new Date().toISOString().replace(/[:.]/g,'-');
  const target=path.join(dir,`suntecsds-service-model-${org.shortCode}-${stamp}.json`);
  const [severities,priorities,environments,issueTypes,workflows,paths,slas,clients]=await Promise.all([
    Severity.find({organizationId:org._id}),Priority.find({organizationId:org._id}),Environment.find({organizationId:org._id}),IssueType.find({organizationId:org._id}),Workflow.find({organizationId:org._id}),SupportPath.find({organizationId:org._id}),SlaPolicy.find({organizationId:org._id}),Client.find({organizationId:org._id})
  ]);
  const payload={ createdAt:new Date().toISOString(), sourceNote:SOURCE_NOTE, organization:plain(org), selectedClient:plain(client), collections:{ severities:severities.map(plain), priorities:priorities.map(plain), environments:environments.map(plain), issueTypes:issueTypes.map(plain), workflows:workflows.map(plain), supportPaths:paths.map(plain), slaPolicies:slas.map(plain), clients:clients.map(plain) } };
  await fs.writeFile(target,`${JSON.stringify(payload,null,2)}\n`,'utf8'); return target;
}

function buildOperationalRuleDefinitions(issueTypeMap,pathMap,severityMap,environmentMap,parallelMode,allowedFamilySymbols=new Set()) {
  const output=[];
  const allow=(typeDef)=>allowedFamilySymbols.has(typeDef.family);
  const appDef=ISSUE_TYPES.find((item)=>item.symbol==='INC_APP');
  const app=allow(appDef) ? issueTypeMap.get('INC_APP') : null;
  if(app){
    if(parallelMode==='s1-s2-prod-dr'){
      output.push({ localId:'prov_inc_app_critical', type:app, path:pathMap.get('PATH_INC_APP_PARALLEL'), severityIds:['S1','S2'].map((code)=>severityMap.get(code)?._id).filter(Boolean), environmentIds:['PROD','DR'].map((code)=>environmentMap.get(code)?._id).filter(Boolean) });
      output.push({ localId:'prov_inc_app_default', type:app, path:pathMap.get('PATH_INC_APP_STANDARD'), severityIds:[], environmentIds:[] });
    } else {
      output.push({ localId:'prov_inc_app_all_parallel', type:app, path:pathMap.get('PATH_INC_APP_PARALLEL'), severityIds:[], environmentIds:[] });
    }
  }
  for(const typeDef of ISSUE_TYPES.filter((item)=>item.symbol!=='INC_APP' && allow(item))){
    const type=issueTypeMap.get(typeDef.symbol); const pathDoc=pathMap.get(typeDef.defaultPath);
    if(type&&pathDoc) output.push({ localId:`prov_${typeDef.symbol.toLowerCase()}`.slice(0,60), type, path:pathDoc, severityIds:[], environmentIds:[] });
  }
  return output;
}

function baseClientPayload({ org, def, parent=null, template=null, environmentMap }) {
  const inheritedPath=parent ? [...(parent.path||[]), parent._id] : [];
  const templateProductIds=(template?.enabledProductIds||[]).map((item)=>item);
  const templateModuleIds=(template?.enabledModuleIds||[]).map((item)=>item);
  return {
    organizationId:org._id,
    parentClientId:parent?._id||null,
    name:def.name,
    shortCode:def.shortCode,
    primaryDomain:def.primaryDomain||'',
    description:def.description||'',
    notes:'Provisioned for SunTecSDS UAT service-model testing.',
    regionId:template?.regionId||null,
    subregionId:template?.subregionId||null,
    timezone:template?.timezone||'',
    status:'active',
    depth:parent ? Number(parent.depth||0)+1 : 0,
    path:inheritedPath,
    issueTypeMode:parent?'inherit':'custom',
    enabledLevel1IssueTypeIds:[],
    slaMode:parent?'inherit':'custom',
    defaultSlaPolicyId:null,
    productModuleMode:parent?'inherit':'custom',
    enabledProductIds:parent?[]:templateProductIds,
    enabledModuleIds:parent?[]:templateModuleIds,
    enabledEnvironmentIds:[...environmentMap.values()].map((item)=>item._id),
    operationalRules:[]
  };
}

async function ensureManagedClient(org, def, { parent=null, template=null, environmentMap, options }) {
  let client=await Client.findOne({ organizationId:org._id, shortCode:def.shortCode });
  if(!client){
    client=new Client(baseClientPayload({ org, def, parent, template, environmentMap }));
    record('create','Client hierarchy',def.shortCode,`${def.name}${parent?` · child of ${parent.shortCode}`:''}`);
    if(options.apply) await client.save();
    return client;
  }
  let changed=false;
  if(parent){
    changed=assignScalar(client,'parentClientId',parent._id)||changed;
    changed=assignScalar(client,'depth',Number(parent.depth||0)+1)||changed;
    changed=assignScalar(client,'path',[...(parent.path||[]),parent._id])||changed;
  }
  if(client.status!=='active') changed=assignScalar(client,'status','active')||changed;
  const envIds=new Set((client.enabledEnvironmentIds||[]).map(String));
  for(const env of environmentMap.values()) envIds.add(String(env._id));
  changed=assignScalar(client,'enabledEnvironmentIds',[...envIds])||changed;
  record(changed?'update':'unchanged','Client hierarchy',def.shortCode,client.name);
  if(changed&&options.apply) await client.save();
  return client;
}

async function ensureStandardBankHierarchy(org, existingRoot, environmentMap, options) {
  let root=existingRoot;
  if(!root && canonical(options.client)===canonical('STDBNK')){
    root=await ensureManagedClient(org,{ shortCode:'STDBNK', name:'Standard Bank', primaryDomain:'standardbank.example.com', description:'Product-support UAT client using the regular Ticket family.' },{ environmentMap, options });
  }
  if(!root) return { root:null, children:[] };
  const knownChildren=[
    { shortCode:'STDCOR', name:'Standard Bank Corporate Banking', description:'Corporate Banking child client; inherits the Ticket service model from Standard Bank.' },
    { shortCode:'STDRTL', name:'Standard Bank Retail Banking', description:'Retail Banking child client; inherits the Ticket service model from Standard Bank.' }
  ];
  const children=[];
  for(const def of knownChildren){
    let child=await Client.findOne({ organizationId:org._id, shortCode:def.shortCode });
    if(!child && canonical(root.shortCode)!==canonical('STDBNK')) continue;
    child=await ensureManagedClient(org,def,{ parent:root, template:root, environmentMap, options });
    children.push(child);
  }
  return { root, children };
}

async function ensureSaasHierarchy(org, standardBankRoot, environmentMap, options) {
  let root=await chooseClient(org._id,options.saasClient);
  const requestedCode=String(options.saasClient||'').trim().toUpperCase();
  if(!root){
    if(!/^[A-Z]{6}$/.test(requestedCode)){
      record('warning','Client hierarchy','saas-root-not-created',`SaaS client ${options.saasClient} was not found and is not a 6-letter client code. Use --saas-client=<6-letter-code> or create it first.`);
      return { root:null, children:[] };
    }
    root=await ensureManagedClient(org,{ shortCode:requestedCode, name:requestedCode==='SAASBK'?'Xelerate SaaS Bank':`Xelerate SaaS Client ${requestedCode}`, primaryDomain:'saasbank.example.com', description:'SaaS managed-support UAT client using Incident, Maintenance Request, and Service Request families.' },{ template:standardBankRoot, environmentMap, options });
  }
  const children=[];
  if(String(root.shortCode).toUpperCase()==='SAASBK'){
    const childDefs=[
      { shortCode:'SAASCO', name:'Xelerate SaaS Corporate Banking', description:'Corporate Banking child client inheriting the SaaS managed-support service model.' },
      { shortCode:'SAASRT', name:'Xelerate SaaS Retail Banking', description:'Retail Banking child client inheriting the SaaS managed-support service model.' }
    ];
    for(const def of childDefs) children.push(await ensureManagedClient(org,def,{ parent:root, template:root, environmentMap, options }));
  }
  return { root, children };
}

async function configureClientForFamilies(org, client, familyMap, issueTypeMap, pathMap, severityMap, environmentMap, slaMap, options, allowedFamilySymbols, { assignRequestedSla=false, label='Client service model' }={}) {
  if(!client){ record('warning',label,'not-found','Client not found; skipped family assignment and routing.'); return; }
  let changed=false;
  const desiredFamilyIds=[...allowedFamilySymbols].map((symbol)=>familyMap.get(symbol)?._id).filter(Boolean);
  changed=assignScalar(client,'issueTypeMode','custom')||changed;
  changed=assignScalar(client,'enabledLevel1IssueTypeIds',desiredFamilyIds)||changed;

  const envIds=new Set((client.enabledEnvironmentIds||[]).map(String));
  for(const env of environmentMap.values()) envIds.add(String(env._id));
  changed=assignScalar(client,'enabledEnvironmentIds',[...envIds])||changed;

  if(assignRequestedSla && options.assignSla!=='none'){
    const policy=slaMap.get(options.assignSla);
    if(policy){ changed=assignScalar(client,'slaMode','custom')||changed; changed=assignScalar(client,'defaultSlaPolicyId',policy._id)||changed; }
  }

  const desiredRules=buildOperationalRuleDefinitions(issueTypeMap,pathMap,severityMap,environmentMap,options.parallelMode,allowedFamilySymbols);
  const allowedSubtypeIds=new Set(ISSUE_TYPES.filter((def)=>allowedFamilySymbols.has(def.family)).map((def)=>issueTypeMap.get(def.symbol)?._id).filter(Boolean).map(String));
  // Client-to-family availability is authoritative. Keep unrelated custom rules only
  // when they belong to an enabled family; remove all stale rules from disabled families.
  // Provisioner-owned rules are then rebuilt from the current service model.
  const nextRules=(client.operationalRules||[]).map(plain).filter((rule)=>!String(rule.localId||'').startsWith('prov_') && allowedSubtypeIds.has(String(rule.level2TypeId||'')));
  for(const desired of desiredRules){
    if(!desired.type||!desired.path) continue;
    nextRules.push({ localId:desired.localId, level2TypeId:desired.type._id, supportPathId:desired.path._id, severityIds:desired.severityIds, environmentIds:desired.environmentIds, inheritToChildren:true, isActive:true });
  }
  if(!isSame(client.operationalRules||[],nextRules)){ client.operationalRules=nextRules; changed=true; }
  record(changed?'update':'unchanged',label,client.shortCode,`${client.name} · families ${[...allowedFamilySymbols].join(', ')}`);
  if(changed&&options.apply) await client.save();

  if(options.children==='inherit'){
    const descendants=await Client.find({ organizationId:org._id, path:client._id });
    for(const child of descendants){
      let childChanged=false;
      childChanged=assignScalar(child,'issueTypeMode','inherit')||childChanged;
      childChanged=assignScalar(child,'enabledLevel1IssueTypeIds',[])||childChanged;
      childChanged=assignScalar(child,'operationalRules',(child.operationalRules||[]).map(plain).filter((rule)=>!String(rule.localId||'').startsWith('prov_') && allowedSubtypeIds.has(String(rule.level2TypeId||''))))||childChanged;
      if(assignRequestedSla && options.assignSla!=='none'){ childChanged=assignScalar(child,'slaMode','inherit')||childChanged; childChanged=assignScalar(child,'defaultSlaPolicyId',null)||childChanged; }
      const childEnvs=new Set((child.enabledEnvironmentIds||[]).map(String)); for(const env of environmentMap.values()) childEnvs.add(String(env._id));
      childChanged=assignScalar(child,'enabledEnvironmentIds',[...childEnvs])||childChanged;
      record(childChanged?'update':'unchanged','Child client family inheritance',child.shortCode,`${child.name} · inherits from ${client.shortCode}`);
      if(childChanged&&options.apply) await child.save();
    }
  }
}

function printPlan(options, org, productClient, saasClient) {
  console.log(`\nOrganization: ${org.name} [${org.shortCode}] slug=${org.workspaceSlug||'-'}`);
  console.log(`Product-support client: ${productClient ? `${productClient.name} [${productClient.shortCode}] · Ticket only` : `${options.client} (not found)`}`);
  console.log(`SaaS managed-support client: ${saasClient ? `${saasClient.name} [${saasClient.shortCode}] · Incident + Maintenance Request + Service Request` : `${options.saasClient} (not found)`}`);
  console.log(`Mode: ${options.apply?'APPLY':'DRY RUN'}`);
  console.log(`Product-client default SLA assignment: ${options.assignSla}`);
  console.log(`SaaS Application parallel rule: ${options.parallelMode}`);
  console.log(`Child handling: ${options.children}`);
  const grouped=new Map();
  for(const item of changes){ if(!grouped.has(item.area)) grouped.set(item.area,[]); grouped.get(item.area).push(item); }
  for(const [area,items] of grouped){
    console.log(`\n${area}`);
    for(const item of items) console.log(`  ${changeMarker(item.action)} ${item.key}${item.detail?` · ${item.detail}`:''}${item.action==='update'?' [update]':item.action==='unchanged'?' [unchanged]':''}`);
  }
  const counts=changes.reduce((acc,item)=>{ acc[item.action]=(acc[item.action]||0)+1; return acc; },{});
  console.log(`\nSummary: create ${counts.create||0}, update ${counts.update||0}, unchanged ${counts.unchanged||0}, warnings ${counts.warning||0}`);
}


async function main() {
  const options=parseArgs(process.argv.slice(2));
  if(options.help){ printHelp(); return; }
  validateCatalog();
  if(options.validateOnly){
    const statusCount=WORKFLOWS.reduce((sum,wf)=>sum+(wf.statuses||[]).length,0);
    const taskCount=WORKFLOWS.reduce((sum,wf)=>sum+(wf.statuses||[]).reduce((inner,status)=>inner+(status.taskTemplates||[]).length,0),0);
    const transitionCount=WORKFLOWS.reduce((sum,wf)=>sum+(wf.transitions||[]).length,0);
    console.log(`Catalogue valid: ${ISSUE_FAMILIES.length} families, ${ISSUE_TYPES.length} subtypes, ${WORKFLOWS.length} workflows, ${statusCount} statuses, ${taskCount} task templates, ${transitionCount} transitions, ${SUPPORT_PATHS.length} support paths, ${SLA_DEFINITIONS.length} SLA policies.`);
    return;
  }
  await connectDatabase();
  let backupPath='';
  try{
    const org=await chooseOrganization(options.organization);
    const existingProductClient=await chooseClient(org._id,options.client);
    if(options.apply) backupPath=await writeBackup(org,existingProductClient);

    const severityMap=new Map(); for(const def of CONFIG.severities) severityMap.set(def.code,await ensureSeverity(org,def,options));
    const priorityMap=new Map(); for(const def of CONFIG.priorities) priorityMap.set(def.code,await ensurePriority(org,def,options));
    const environmentMap=new Map(); for(const def of CONFIG.environments) environmentMap.set(def.code,await ensureEnvironment(org,def,options));

    const workflowMap=new Map(); for(const def of WORKFLOWS) workflowMap.set(def.key,await ensureWorkflow(org,def,options));
    const pathMap=new Map(); for(const def of SUPPORT_PATHS) pathMap.set(def.key,await ensureSupportPath(org,def,workflowMap,options));
    const slaMap=new Map(); for(const def of SLA_DEFINITIONS) slaMap.set(def.symbol,await ensureSla(org,def,severityMap,environmentMap,options));

    const familyMap=new Map(); for(const def of ISSUE_FAMILIES) familyMap.set(def.symbol,await ensureFamily(org,def,options));
    const issueTypeMap=new Map();
    for(const def of ISSUE_TYPES){
      const familyDoc=familyMap.get(def.family); const workflowDoc=workflowMap.get(def.defaultWorkflow); const pathDoc=pathMap.get(def.defaultPath);
      issueTypeMap.set(def.symbol,await ensureIssueType(org,familyDoc,def,workflowDoc,pathDoc,options));
    }

    const standardHierarchy=await ensureStandardBankHierarchy(org,existingProductClient,environmentMap,options);
    const saasHierarchy=await ensureSaasHierarchy(org,standardHierarchy.root,environmentMap,options);

    await configureClientForFamilies(org,standardHierarchy.root,familyMap,issueTypeMap,pathMap,severityMap,environmentMap,slaMap,options,new Set(['TKT']),{ assignRequestedSla:true, label:'Product-support client service model' });
    await configureClientForFamilies(org,saasHierarchy.root,familyMap,issueTypeMap,pathMap,severityMap,environmentMap,slaMap,options,new Set(['INC','MR','SR']),{ assignRequestedSla:false, label:'SaaS client service model' });

    record('warning','Known configuration limits','per-family-sla','The current Client model supports one default SLA policy per client. The provisioner creates SaaS Sample plus Silver/Gold/Platinum policies but does not blindly assign one to the SaaS client because different families can require different SLA behavior.');
    record('warning','Known configuration limits','previous-status-reversion','Deferred / On Hold / Under Monitoring can be provisioned, but the current workflow model cannot dynamically enforce return only to the immediately preceding status.');
    record('warning','Known configuration limits','bank-to-verify-assignee','Bank to Verify is provisioned with Bank-facing tasks, but current role-level action controls cannot fully restrict/enable L2/L3 task completion solely by Bank users.');
    record('warning','Known configuration limits','timed-reminders','Privileged-access expiry, 3-hour DEBUG expiry, 15-hour environment-window validation, and repeated reminder schedules require application automation beyond static configuration.');
    record('warning','Known configuration limits','approval-role-enforcement','Closure and approval tasks are provisioned, but the workflow schema itself does not encode per-transition role restrictions.');

    printPlan(options,org,standardHierarchy.root,saasHierarchy.root);
    if(!options.apply){ console.log('\nNo database changes made. Re-run with --apply after reviewing this plan.'); }
    else { console.log(`\nProvisioning complete. Backup: ${path.relative(projectRoot,backupPath)}`); }
  } finally {
    await disconnectDatabase();
  }
}

main().catch(async(error)=>{
  console.error(`\nProvisioning failed: ${error.message}`);
  try{ await disconnectDatabase(); }catch{}
  process.exitCode=1;
});
