#!/usr/bin/env node
/**
 * Service Manager v24.2.4 — refresh workflow snapshots on EXISTING open UAT requests.
 *
 * This is intentionally separate from the configuration migration.
 * DRY RUN is the default. --apply writes a JSON backup before changing requests.
 *
 * It updates ONLY workflow/support-path snapshots and status metadata. It does not
 * delete or rewrite comments, attachments, timeline, tasks, ownership, SLA clocks,
 * severity, priority, client, requester or request numbers.
 *
 * Usage:
 *   node scripts/sync-open-requests-to-v24.2.4-workflows.mjs --workspace=suntecgroup
 *   node scripts/sync-open-requests-to-v24.2.4-workflows.mjs --workspace=suntecgroup --apply
 * Optional:
 *   --backup-dir=./backups/v24.2.4-open-request-sync
 *   --include-resolved
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import mongoose from 'mongoose';

import { connectDatabase, disconnectDatabase } from '../services/request-service/src/db.js';
import { Organization } from '../services/organization-service/src/models/Organization.js';
import { Workflow } from '../services/organization-service/src/models/Workflow.js';
import { SupportPath } from '../services/organization-service/src/models/SupportPath.js';
import { ServiceRequest } from '../services/request-service/src/models/ServiceRequest.js';

const args = new Set(process.argv.slice(2));
const APPLY = args.has('--apply');
const INCLUDE_RESOLVED = args.has('--include-resolved');
function valueArg(name, fallback = '') {
  const prefix = `${name}=`;
  const value = process.argv.slice(2).find((item) => item.startsWith(prefix));
  return value ? value.slice(prefix.length) : fallback;
}
const WORKSPACE = String(valueArg('--workspace', 'suntecgroup')).trim().toLowerCase();
const BACKUP_ROOT = path.resolve(process.cwd(), valueArg('--backup-dir', './backups/v24.2.4-open-request-sync'));
const MODEL_KEY = 'SUNTEC_SAAS_V24';
const VERSION = '24.2.4';
const INCIDENT_PATH_KEY = 'PATH_INCIDENT_COMMON_V24';
const WORKFLOW_BY_FAMILY = new Map([
  ['INCIDENT', 'WF_SAAS_INCIDENT'],
  ['PROBLEM', 'WF_SAAS_PROBLEM'],
  ['CHANGE_REQUEST', 'WF_SAAS_CHANGE'],
  ['CHANGE', 'WF_SAAS_CHANGE'],
  ['MAINTENANCE_REQUEST', 'WF_SAAS_MAINTENANCE'],
  ['MAINTENANCE', 'WF_SAAS_MAINTENANCE']
]);

function normalize(value) {
  return String(value || '').trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}
function timestamp() { return new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z'); }
function plain(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }
function namedRef(doc) { return { id: String(doc?._id || ''), name: String(doc?.name || ''), code: String(doc?.key || '') }; }
function workflowDefinition(workflow) {
  const src = plain(workflow);
  return {
    statuses: (src.statuses || []).map((s) => ({
      localId: s.localId, name: s.name, description: s.description || `${s.name} stage.`,
      customerLabel: s.customerLabel || s.name, statusType: s.statusType || 'normal',
      isCustomerVisible: s.isCustomerVisible !== false, taskTemplates: s.taskTemplates || [],
      jiraStatusId: s.jiraStatusId || '', jiraStatusCategory: s.jiraStatusCategory || '',
      approvalConfiguration: s.approvalConfiguration || null, sourceProperties: s.sourceProperties || {},
      jiraDescription: s.jiraDescription || ''
    })),
    transitions: (src.transitions || []).map((t) => ({
      fromStatusId: t.fromStatusId, toStatusId: t.toStatusId, localId: t.localId || '',
      name: t.name || '', transitionType: t.transitionType || 'status',
      customerEnabled: t.customerEnabled === true, clientEnabled: t.clientEnabled === true,
      jiraCustomerEnabled: t.jiraCustomerEnabled === true, allowedSupportLevels: t.allowedSupportLevels || [], roles: t.roles || [],
      targetSupportLevel: t.targetSupportLevel || '', jiraTransitionId: t.jiraTransitionId || '',
      jiraTransitionType: t.jiraTransitionType || '', condition: t.condition || {}, supportEffect: t.supportEffect || {},
      transitionScreenId: t.transitionScreenId || '', requiredFields: t.requiredFields || [],
      screenFields: t.screenFields || [], jiraRules: t.jiraRules || {}
    })),
    globalActions: (src.globalActions || []).map((a) => ({
      key: a.key, label: a.label, kind: a.kind || 'escalation', statusEffect: a.statusEffect || 'KEEP',
      customerEnabled: a.customerEnabled === true, clientEnabled: a.clientEnabled === true,
      jiraCustomerEnabled: a.jiraCustomerEnabled === true, roles: a.roles || [], jiraTransitionId: a.jiraTransitionId || '',
      condition: a.condition || {}, requiredFields: a.requiredFields || [], jiraRules: a.jiraRules || {}
    })),
    sourceMetadata: src.sourceMetadata || src.jiraSource || {}
  };
}
function statusMap(definition) { return new Map((definition.statuses || []).map((s) => [String(s.localId || '').toUpperCase(), s])); }
function refreshedStatus(existing, byId) {
  const id = String(existing?.localId || '').trim().toUpperCase();
  if (!id || !byId.has(id)) return null;
  return plain(byId.get(id));
}
function inferOriginSupportLevel(req = {}) {
  const explicit = String(req.originSupportLevel || '').trim().toUpperCase();
  if (['L1','L2','L3'].includes(explicit)) return explicit;
  const source = String(req.source || '').trim().toLowerCase();
  if (['client_portal','client_asked_agent'].includes(source)) return 'L1';
  if (source === 'partner_observed') return 'L2';
  if (['internal_observed','system_alert'].includes(source)) return 'L3';
  const visibility = String(req.visibilityScope || '').trim().toLowerCase();
  if (visibility === 'client_visible') return 'L1';
  if (visibility === 'partner_visible') return 'L2';
  return String(req.currentSupportLevel || 'L3').trim().toUpperCase();
}
function inferPreviousStatus(req = {}, stage = {}, byId = new Map()) {
  const explicit = String(stage.previousStatusId || '').trim().toUpperCase();
  if (explicit && byId.has(explicit)) return { id: explicit, name: byId.get(explicit)?.name || stage.previousStatusName || explicit };
  const currentName = String(stage.currentStatus?.name || '').trim().toLowerCase();
  const timeline = [...(req.timeline || [])].reverse();
  for (const event of timeline) {
    const message = String(event.message || '');
    const match = message.match(/(?:status|stage).*?from\s+(.+?)\s+to\s+(.+?)(?:\.|$)/i) || message.match(/(.+?)\s*[→>-]+\s*(.+?)(?:\.|$)/);
    if (!match) continue;
    const fromName = String(match[1] || '').trim();
    const toName = String(match[2] || '').trim();
    if (currentName && !toName.toLowerCase().includes(currentName)) continue;
    const found = [...byId.values()].find((status) => String(status.name || '').trim().toLowerCase() === fromName.toLowerCase());
    if (found) return { id: String(found.localId || '').toUpperCase(), name: found.name || fromName };
  }
  return { id: '', name: '' };
}
function supportPathDefinition(pathDoc, incidentWorkflow) {
  const path = plain(pathDoc);
  const def = workflowDefinition(incidentWorkflow);
  const wfRef = namedRef(incidentWorkflow);
  return {
    levels: (path.levels || []).map((level) => ({
      localId: level.localId, label: level.label, ownerSide: level.ownerSide,
      slaApplicable: level.slaApplicable === true, displayOrder: level.displayOrder || 100,
      workflowId: String(incidentWorkflow._id), workflowName: incidentWorkflow.name,
      workflow: wfRef, workflowDefinition: def
    })),
    movementRules: (path.movementRules || []).map((r) => ({
      localId: r.localId, actionLabel: r.actionLabel, fromLevelId: r.fromLevelId, toLevelId: r.toLevelId,
      movementType: r.movementType || 'sequential', toLevelIds: r.toLevelIds || [], primaryLevelId: r.primaryLevelId || '',
      targetStatusBehavior: r.targetStatusBehavior || 'explicit', targetStatusId: r.targetStatusId || '',
      allowedFromStatusIds: r.allowedFromStatusIds || [], customerEnabled: r.customerEnabled === true,
      roles: r.roles || [], condition: r.condition || {}, commentRequired: r.commentRequired !== false,
      reasonRequired: r.reasonRequired !== false, displayOrder: r.displayOrder || 100
    }))
  };
}

async function findOrg() {
  const escaped = WORKSPACE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const org = await Organization.findOne({
    $or: [
      { workspaceSlug: WORKSPACE },
      { shortCode: WORKSPACE.toUpperCase() },
      { name: new RegExp(`^${escaped}$`, 'i') }
    ]
  }).lean();
  if (!org) throw new Error(`Organization/workspace '${WORKSPACE}' not found.`);
  return org;
}

async function main() {
  console.log(`\nService Manager ${VERSION} open-request workflow sync`);
  console.log(`Workspace : ${WORKSPACE}`);
  console.log(`Mode      : ${APPLY ? 'APPLY' : 'DRY RUN'}`);
  console.log(`Resolved  : ${INCLUDE_RESOLVED ? 'included' : 'excluded'}\n`);

  await connectDatabase();
  try {
    const org = await findOrg();
    const workflowKeys = [...new Set(WORKFLOW_BY_FAMILY.values())];
    const workflowDocs = await Workflow.find({ organizationId: org._id, key: { $in: workflowKeys }, status: 'active' }).lean();
    const workflows = new Map(workflowDocs.map((w) => [w.key, w]));
    for (const key of workflowKeys) if (!workflows.has(key)) throw new Error(`Missing active workflow ${key}. Run the v24.2.4 configuration migration first.`);
    const incidentPath = await SupportPath.findOne({ organizationId: org._id, key: INCIDENT_PATH_KEY, status: 'active' }).lean();
    if (!incidentPath) throw new Error(`Missing active support path ${INCIDENT_PATH_KEY}. Run the v24.2.4 configuration migration first.`);

    const lifecycleStates = INCLUDE_RESOLVED ? ['open', 'returned', 'resolved'] : ['open', 'returned'];
    const requests = await ServiceRequest.find({
      organizationId: org._id,
      serviceModelKey: MODEL_KEY,
      lifecycleState: { $in: lifecycleStates }
    }).sort({ requestNumber: 1 }).lean();

    const candidates = [];
    const skipped = [];
    for (const req of requests) {
      const family = normalize(req.level2Type?.name || req.level2Type?.code || '');
      const workflowKey = WORKFLOW_BY_FAMILY.get(family);
      if (!workflowKey) continue;
      const workflow = workflows.get(workflowKey);
      const def = workflowDefinition(workflow);
      const byId = statusMap(def);
      const rootStatus = refreshedStatus(req.currentStatus, byId);
      if (!rootStatus) {
        skipped.push({ requestNumber: req.requestNumber, reason: `root status ${req.currentStatus?.localId || '(blank)'} not present in ${workflowKey}` });
        continue;
      }
      const refreshedStages = [];
      let stageError = '';
      for (const stage of req.activeStages || []) {
        const currentStatus = refreshedStatus(stage.currentStatus, byId);
        if (!currentStatus) { stageError = `stage ${stage.localId} status ${stage.currentStatus?.localId || '(blank)'} not present in ${workflowKey}`; break; }
        const previousStatus = inferPreviousStatus(req, stage, byId);
        refreshedStages.push({
          ...plain(stage),
          workflow: namedRef(workflow),
          workflowDefinition: def,
          currentStatus,
          previousStatusId: previousStatus.id,
          previousStatusName: previousStatus.name
        });
      }
      if (stageError) { skipped.push({ requestNumber: req.requestNumber, reason: stageError }); continue; }

      const update = {
        workflow: namedRef(workflow),
        workflowDefinition: def,
        currentStatus: rootStatus,
        activeStages: refreshedStages,
        originSupportLevel: inferOriginSupportLevel(req)
      };
      if (workflowKey === 'WF_SAAS_INCIDENT') {
        update.supportPath = namedRef(incidentPath);
        update.supportPathDefinition = supportPathDefinition(incidentPath, workflow);
      }
      candidates.push({ req, family, workflowKey, update });
    }

    console.log(`Eligible requests : ${candidates.length}`);
    console.log(`Skipped requests  : ${skipped.length}`);
    for (const item of candidates) console.log(`  ${APPLY ? '✓' : '~'} ${item.req.requestNumber} · ${item.family} · ${item.req.currentStatus?.localId} · ${item.workflowKey}`);
    for (const item of skipped) console.log(`  ! ${item.requestNumber} · ${item.reason}`);

    if (!APPLY) {
      console.log('\nDRY RUN only. Re-run with --apply after reviewing the list.');
      return;
    }
    if (!candidates.length) {
      console.log('\nNothing to update.');
      return;
    }

    const backupDir = path.join(BACKUP_ROOT, `${WORKSPACE}-${timestamp()}`);
    fs.mkdirSync(backupDir, { recursive: true });
    fs.writeFileSync(path.join(backupDir, 'requests-before-workflow-sync.json'), JSON.stringify({
      version: VERSION,
      backedUpAt: new Date().toISOString(),
      workspace: WORKSPACE,
      requestCount: candidates.length,
      requests: candidates.map((item) => item.req)
    }, null, 2));
    console.log(`\nBackup: ${backupDir}`);

    let updated = 0;
    for (const item of candidates) {
      await ServiceRequest.updateOne({ _id: item.req._id, __v: item.req.__v }, { $set: item.update, $inc: { __v: 1 } });
      updated += 1;
    }
    console.log(`Updated ${updated} request(s).`);
    console.log('Comments, attachments, tasks, timeline, assignments, SLA clocks and request numbers were not rewritten.');
  } finally {
    await disconnectDatabase();
  }
}

main().catch((error) => {
  console.error(`\nFAILED: ${error.stack || error.message}`);
  process.exitCode = 1;
});
