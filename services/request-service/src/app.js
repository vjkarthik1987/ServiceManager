import express from 'express';
import mongoose from 'mongoose';
import { config } from './config.js';
import { connectDatabase, disconnectDatabase } from './db.js';
import { requestContext } from './middleware/requestContext.js';
import { ServiceRequest } from './models/ServiceRequest.js';

const app = express();

app.use(express.json({ limit: '1mb' }));
app.use(requestContext);

function isValidId(value) {
  return mongoose.Types.ObjectId.isValid(String(value || ''));
}

function requireText(value, label, min = 1) {
  const trimmed = String(value || '').trim();
  if (trimmed.length < min) {
    const error = new Error(min > 1 ? `${label} must be at least ${min} characters.` : `${label} is required.`);
    error.status = 400;
    throw error;
  }
  return trimmed;
}

function cleanRef(value = {}) {
  return {
    id: String(value.id || value._id || '').trim(),
    name: String(value.name || '').trim(),
    code: String(value.code || '').trim().toUpperCase()
  };
}

function cleanActor(value = {}) {
  return {
    actorId: String(value.actorId || value.id || '').trim(),
    name: String(value.name || '').trim(),
    email: String(value.email || '').trim().toLowerCase(),
    userType: String(value.userType || '').trim(),
    portal: String(value.portal || '').trim()
  };
}


function cleanCustomFields(value = []) {
  const source = Array.isArray(value) ? value : [];
  return source
    .map((item) => {
      const fieldType = String(item.fieldType || 'short_text').trim();
      let value = item.value;
      if (fieldType === 'checkbox') value = value === true || value === 'true' || value === 'on' || value === 'yes';
      if (fieldType === 'multi_select') value = Array.isArray(value) ? value.map(String) : String(value || '').split('||').filter(Boolean);
      const displayValue = Array.isArray(value) ? value.join(', ') : fieldType === 'checkbox' ? (value ? 'Yes' : 'No') : String(value ?? '');
      return {
        fieldKey: String(item.fieldKey || '').trim().toUpperCase().slice(0, 60),
        label: String(item.label || '').trim().slice(0, 120),
        fieldType,
        value,
        displayValue: String(item.displayValue || displayValue).trim().slice(0, 1200)
      };
    })
    .filter((item) => item.fieldKey && item.label);
}

function cleanSlaDefinition(value = {}) {
  const rules = Array.isArray(value.rules) ? value.rules.map((rule) => ({
    ruleBasis: String(rule.ruleBasis || 'severity').trim(),
    severityId: String(rule.severityId || '').trim(),
    priorityId: String(rule.priorityId || '').trim(),
    responseTimeValue: Number.isFinite(Number(rule.responseTimeValue)) ? Number(rule.responseTimeValue) : null,
    responseTimeUnit: String(rule.responseTimeUnit || 'hours').trim(),
    resolutionTimeValue: Number.isFinite(Number(rule.resolutionTimeValue)) ? Number(rule.resolutionTimeValue) : null,
    resolutionTimeUnit: String(rule.resolutionTimeUnit || 'hours').trim(),
    updateFrequencyValue: Number.isFinite(Number(rule.updateFrequencyValue)) ? Number(rule.updateFrequencyValue) : null,
    updateFrequencyUnit: String(rule.updateFrequencyUnit || 'daily').trim(),
    clockType: String(rule.clockType || 'working_hours').trim(),
    notes: String(rule.notes || '').trim()
  })) : [];
  return {
    supportWindow: String(value.supportWindow || 'business_hours').trim(),
    clockStartTrigger: String(value.clockStartTrigger || 'severity_selected').trim(),
    rules,
    applicability: {
      applyOnlyWhenSeveritySelected: value.applicability?.applyOnlyWhenSeveritySelected !== false,
      applicableEnvironmentIds: Array.isArray(value.applicability?.applicableEnvironmentIds) ? value.applicability.applicableEnvironmentIds.map(String) : [],
      applicableIssueLevelCodes: Array.isArray(value.applicability?.applicableIssueLevelCodes) ? value.applicability.applicableIssueLevelCodes.map((x) => String(x).toUpperCase()) : ['L2','L3']
    }
  };
}

function unitToMinutes(value, unit) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0 || unit === 'none') return null;
  if (unit === 'minutes') return amount;
  if (unit === 'hours' || unit === 'business_hours') return amount * 60;
  if (unit === 'days' || unit === 'business_days') return amount * 24 * 60;
  return amount * 60;
}

function addMinutes(date, minutes) {
  return new Date(date.getTime() + minutes * 60 * 1000);
}

function chooseNextSlaStep({ state, responseDueAt, resolutionDueAt }) {
  const now = Date.now();
  const responseDate = responseDueAt ? new Date(responseDueAt) : null;
  const resolutionDate = resolutionDueAt ? new Date(resolutionDueAt) : null;
  if (!['running', 'at_risk', 'breached'].includes(state)) return { nextActionLabel: '', nextDueAt: null };
  if (responseDate && !Number.isNaN(responseDate.getTime()) && responseDate.getTime() > now) {
    return { nextActionLabel: 'Respond by', nextDueAt: responseDate };
  }
  if (resolutionDate && !Number.isNaN(resolutionDate.getTime())) {
    return { nextActionLabel: resolutionDate.getTime() < now ? 'Resolution overdue since' : 'Resolve by', nextDueAt: resolutionDate };
  }
  if (responseDate && !Number.isNaN(responseDate.getTime())) {
    return { nextActionLabel: responseDate.getTime() < now ? 'Response overdue since' : 'Respond by', nextDueAt: responseDate };
  }
  return { nextActionLabel: 'SLA running', nextDueAt: null };
}

function calculateSla(requestItem) {
  const now = new Date();
  const base = {
    state: 'not_applicable', rag: 'grey', reason: '', policyName: requestItem.slaPolicy?.name || '',
    ruleLabel: '', basis: '', startedAt: requestItem.sla?.startedAt || null, responseDueAt: null, resolutionDueAt: null, nextActionLabel: '', nextDueAt: null, lastCalculatedAt: now
  };
  if (['closed', 'cancelled', 'returned'].includes(requestItem.lifecycleState)) {
    return { ...base, state: 'stopped', rag: 'grey', reason: 'Request is closed or returned.' };
  }
  if (requestItem.lifecycleState === 'resolved') {
    return { ...base, state: 'met', rag: 'green', reason: 'Request is resolved.' };
  }
  const level = (requestItem.supportPathDefinition?.levels || []).find((item) => item.localId === requestItem.currentSupportLevel);
  if (!level || level.slaApplicable !== true) {
    return { ...base, state: 'not_applicable', rag: 'grey', reason: `SLA is not active at ${requestItem.currentSupportLevel || 'this support level'}.` };
  }
  if (!requestItem.slaPolicy?.id || !(requestItem.slaDefinition?.rules || []).length) {
    return { ...base, state: 'waiting', rag: 'grey', reason: 'No SLA policy is assigned.' };
  }
  const issueLevels = requestItem.slaDefinition?.applicability?.applicableIssueLevelCodes || [];
  if (issueLevels.length && !issueLevels.includes(String(requestItem.currentSupportLevel || '').toUpperCase())) {
    return { ...base, state: 'not_applicable', rag: 'grey', reason: 'SLA policy does not apply to this support level.' };
  }
  const environmentIds = requestItem.slaDefinition?.applicability?.applicableEnvironmentIds || [];
  if (environmentIds.length && requestItem.environment?.id && !environmentIds.map(String).includes(String(requestItem.environment.id))) {
    return { ...base, state: 'not_applicable', rag: 'grey', reason: 'SLA policy does not apply to the selected environment.' };
  }
  let rule = null;
  if (requestItem.severity?.id) rule = (requestItem.slaDefinition.rules || []).find((item) => item.ruleBasis === 'severity' && String(item.severityId) === String(requestItem.severity.id));
  if (!rule && requestItem.priority?.id) rule = (requestItem.slaDefinition.rules || []).find((item) => item.ruleBasis === 'priority' && String(item.priorityId) === String(requestItem.priority.id));
  if (!rule) {
    return { ...base, state: 'waiting', rag: 'grey', reason: requestItem.slaDefinition?.clockStartTrigger === 'priority_selected' ? 'Waiting for priority to start SLA.' : 'Waiting for severity or matching SLA rule.' };
  }
  const responseMinutes = unitToMinutes(rule.responseTimeValue, rule.responseTimeUnit);
  const resolutionMinutes = unitToMinutes(rule.resolutionTimeValue, rule.resolutionTimeUnit);
  const startedAt = requestItem.sla?.startedAt || now;
  const responseDueAt = responseMinutes ? addMinutes(startedAt, responseMinutes) : null;
  const resolutionDueAt = resolutionMinutes ? addMinutes(startedAt, resolutionMinutes) : null;
  let state = 'running';
  let rag = 'green';
  let reason = 'SLA is running.';
  const due = resolutionDueAt || responseDueAt;
  if (due && now > due) { state = 'breached'; rag = 'red'; reason = 'SLA has breached.'; }
  else if (due && resolutionMinutes) {
    const elapsed = now.getTime() - startedAt.getTime();
    const total = due.getTime() - startedAt.getTime();
    if (total > 0 && elapsed / total >= 0.75) { state = 'at_risk'; rag = 'amber'; reason = 'SLA is nearing breach.'; }
  } else if (responseDueAt && now > responseDueAt) { state = 'at_risk'; rag = 'amber'; reason = 'Response target has passed.'; }
  const ruleLabel = rule.ruleBasis === 'priority' ? (requestItem.priority?.code || requestItem.priority?.name || 'Priority rule') : (requestItem.severity?.code || requestItem.severity?.name || 'Severity rule');
  const nextStep = chooseNextSlaStep({ state, responseDueAt, resolutionDueAt });
  return { ...base, state, rag, reason, startedAt, responseDueAt, resolutionDueAt, ...nextStep, basis: rule.ruleBasis, ruleLabel, policyName: requestItem.slaPolicy?.name || '', lastCalculatedAt: now };
}


function activeSlaRule(requestItem) {
  const rules = requestItem.slaDefinition?.rules || [];
  if (requestItem.severity?.id) {
    const severityRule = rules.find((item) => item.ruleBasis === 'severity' && String(item.severityId) === String(requestItem.severity.id));
    if (severityRule) return severityRule;
  }
  if (requestItem.priority?.id) {
    const priorityRule = rules.find((item) => item.ruleBasis === 'priority' && String(item.priorityId) === String(requestItem.priority.id));
    if (priorityRule) return priorityRule;
  }
  return null;
}

function milestoneStateFromDue(dueAt, actualAt, startedAt, label = '') {
  const now = new Date();
  const due = dueAt ? new Date(dueAt) : null;
  const actual = actualAt ? new Date(actualAt) : null;
  const milestoneLabel = label || 'Milestone';

  if ((!due || Number.isNaN(due.getTime())) && actual && !Number.isNaN(actual.getTime())) {
    return {
      state: 'met',
      rag: 'grey',
      reason: `${milestoneLabel} was recorded, but no SLA target was configured.`
    };
  }

  if (!due || Number.isNaN(due.getTime())) {
    return { state: 'not_applicable', rag: 'grey', reason: `${milestoneLabel} is not configured.` };
  }

  if (actual && !Number.isNaN(actual.getTime())) {
    const met = actual.getTime() <= due.getTime();
    return { state: met ? 'met' : 'breached', rag: met ? 'green' : 'red', reason: met ? `${milestoneLabel} met.` : `${milestoneLabel} breached.` };
  }

  if (now.getTime() > due.getTime()) {
    return { state: 'breached', rag: 'red', reason: `${milestoneLabel} overdue.` };
  }

  const start = startedAt ? new Date(startedAt) : now;
  const total = due.getTime() - start.getTime();
  const elapsed = now.getTime() - start.getTime();
  if (total > 0 && elapsed / total >= 0.75) {
    return { state: 'at_risk', rag: 'amber', reason: `${milestoneLabel} is approaching its due time.` };
  }
  return { state: 'running', rag: 'green', reason: `${milestoneLabel} is on track.` };
}

function calculateSlaMilestones(requestItem, baseSla = null) {
  const base = baseSla || calculateSla(requestItem);
  const existing = requestItem.slaMilestones || {};
  const rule = activeSlaRule(requestItem);
  const startedAt = base.startedAt || requestItem.sla?.startedAt || null;
  const responseActualAt = existing.response?.actualAt || null;
  const resolutionActualAt = existing.resolution?.actualAt || (['closed', 'resolved'].includes(requestItem.lifecycleState) ? new Date() : null);
  const lastUpdateActualAt = existing.update?.actualAt || null;

  const waitingState = ['waiting', 'not_applicable'].includes(base.state);
  const stoppedState = ['stopped', 'met'].includes(base.state);

  const responseBase = {
    label: 'Response',
    dueAt: base.responseDueAt || null,
    actualAt: responseActualAt,
    targetMinutes: rule ? unitToMinutes(rule.responseTimeValue, rule.responseTimeUnit) : null,
    completedBy: existing.response?.completedBy || {},
    completedByEventId: existing.response?.completedByEventId || ''
  };
  const resolutionBase = {
    label: 'Resolution',
    dueAt: base.resolutionDueAt || null,
    actualAt: resolutionActualAt,
    targetMinutes: rule ? unitToMinutes(rule.resolutionTimeValue, rule.resolutionTimeUnit) : null,
    completedBy: existing.resolution?.completedBy || {},
    completedByEventId: existing.resolution?.completedByEventId || ''
  };

  let response = { ...responseBase, ...milestoneStateFromDue(responseBase.dueAt, responseBase.actualAt, startedAt, 'Response') };
  let resolution = { ...resolutionBase, ...milestoneStateFromDue(resolutionBase.dueAt, resolutionBase.actualAt, startedAt, 'Resolution') };

  if (waitingState) {
    const waitingMilestoneState = base.state === 'waiting' ? 'waiting' : 'not_applicable';
    if (!responseBase.actualAt) {
      response = { ...responseBase, state: waitingMilestoneState, rag: 'grey', reason: base.reason || 'SLA is not active yet.' };
    }
    if (!resolutionBase.actualAt) {
      resolution = { ...resolutionBase, state: waitingMilestoneState, rag: 'grey', reason: base.reason || 'SLA is not active yet.' };
    }
  }
  if (stoppedState && requestItem.lifecycleState === 'closed') {
    response = response.actualAt ? response : { ...response, state: response.state === 'breached' ? 'breached' : 'stopped', rag: response.rag || 'grey', reason: response.reason || 'Request is closed.' };
    resolution = { ...resolutionBase, ...milestoneStateFromDue(resolutionBase.dueAt, resolutionBase.actualAt || new Date(), startedAt, 'Resolution') };
  }

  const updateMinutes = rule ? unitToMinutes(rule.updateFrequencyValue, rule.updateFrequencyUnit) : null;
  let update = {
    label: 'Next update',
    dueAt: null,
    actualAt: lastUpdateActualAt,
    targetMinutes: updateMinutes,
    completedBy: existing.update?.completedBy || {},
    completedByEventId: existing.update?.completedByEventId || '',
    state: 'not_applicable',
    rag: 'grey',
    reason: 'Follow-up cadence is not configured.'
  };
  if (!waitingState && updateMinutes && !['closed', 'cancelled', 'returned'].includes(requestItem.lifecycleState)) {
    const updateAnchor = lastUpdateActualAt || responseActualAt || startedAt;
    if (updateAnchor) {
      const dueAt = addMinutes(new Date(updateAnchor), updateMinutes);
      update = { ...update, dueAt, ...milestoneStateFromDue(dueAt, null, updateAnchor, 'Next update') };
      update.reason = lastUpdateActualAt ? 'Next public update is due.' : 'First public update cadence is running.';
    }
  }

  return { response, resolution, update };
}

function summarizeSlaFromMilestones(baseSla, milestones = {}) {
  const ranked = [milestones.response, milestones.resolution, milestones.update].filter(Boolean);
  const hasActiveDue = ranked.some((item) => item?.dueAt);
  const eligible = ranked.filter((item) => item && (item.dueAt || ['breached', 'at_risk', 'running'].includes(item.state)));

  if (!hasActiveDue && ['not_applicable', 'waiting', 'stopped'].includes(baseSla.state)) {
    return {
      ...baseSla,
      rag: baseSla.rag || 'grey',
      state: baseSla.state || 'not_applicable',
      responseDueAt: milestones.response?.dueAt || baseSla.responseDueAt || null,
      resolutionDueAt: milestones.resolution?.dueAt || baseSla.resolutionDueAt || null
    };
  }

  const rag = eligible.some((item) => item.rag === 'red') ? 'red'
    : eligible.some((item) => item.rag === 'amber') ? 'amber'
    : eligible.some((item) => item.rag === 'green') ? 'green'
    : (baseSla.rag || 'grey');
  const state = eligible.some((item) => item.state === 'breached') ? 'breached'
    : eligible.some((item) => item.state === 'at_risk') ? 'at_risk'
    : eligible.some((item) => item.state === 'running') ? 'running'
    : ranked.every((item) => ['met', 'not_applicable', 'stopped'].includes(item.state)) && ranked.some((item) => item.state === 'met' && item.dueAt) ? 'met'
    : (baseSla.state || 'not_applicable');
  const next = [milestones.response, milestones.update, milestones.resolution]
    .filter((item) => item && ['running', 'at_risk', 'breached'].includes(item.state) && item.dueAt)
    .sort((a, b) => new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime())[0];
  return {
    ...baseSla,
    state,
    rag,
    reason: next ? next.reason : (baseSla.reason || ''),
    responseDueAt: milestones.response?.dueAt || baseSla.responseDueAt || null,
    resolutionDueAt: milestones.resolution?.dueAt || baseSla.resolutionDueAt || null,
    nextActionLabel: next ? (next.label === 'Response' ? (next.state === 'breached' ? 'Response overdue since' : 'Respond by') : next.label === 'Resolution' ? (next.state === 'breached' ? 'Resolution overdue since' : 'Resolve by') : (next.state === 'breached' ? 'Update overdue since' : 'Update by')) : baseSla.nextActionLabel,
    nextDueAt: next?.dueAt || baseSla.nextDueAt || null
  };
}

function syncSlaState(requestItem) {
  const base = calculateSla(requestItem);
  const milestones = calculateSlaMilestones(requestItem, base);
  requestItem.slaMilestones = milestones;
  requestItem.sla = summarizeSlaFromMilestones(base, milestones);
  return requestItem.sla;
}

function markResponseMet(requestItem, actor = {}, eventId = 'manual_acknowledge', at = new Date()) {
  const existing = requestItem.slaMilestones || {};
  requestItem.slaMilestones = {
    ...existing,
    response: {
      ...(existing.response || {}),
      label: 'Response',
      actualAt: existing.response?.actualAt || at,
      completedBy: existing.response?.completedBy?.actorId ? existing.response.completedBy : actor,
      completedByEventId: existing.response?.completedByEventId || eventId
    }
  };
}

function markPublicUpdate(requestItem, actor = {}, eventId = 'comment_update', at = new Date()) {
  const existing = requestItem.slaMilestones || {};
  requestItem.slaMilestones = {
    ...existing,
    update: {
      ...(existing.update || {}),
      label: 'Next update',
      actualAt: at,
      completedBy: actor,
      completedByEventId: eventId
    }
  };
}

function slaHistoryMessage(previous = {}, current = {}) {
  if (!current || !current.state) return '';
  if (previous.state === current.state && previous.rag === current.rag && String(previous.startedAt || '') === String(current.startedAt || '')) return '';
  if (current.state === 'running' || current.state === 'at_risk' || current.state === 'breached') return `SLA ${current.state.replace('_', ' ')} · ${String(current.rag || '').toUpperCase()}. ${current.reason}`;
  if (current.state === 'waiting') return `SLA waiting. ${current.reason}`;
  if (current.state === 'not_applicable') return `SLA not applicable. ${current.reason}`;
  return `SLA ${current.state}. ${current.reason}`;
}

function cleanAttachments(value = [], actor = {}) {
  const source = Array.isArray(value) ? value : [];
  return source
    .map((item) => ({
      fileName: String(item.fileName || item.name || '').trim().slice(0, 260),
      note: String(item.note || '').trim().slice(0, 260),
      fileUrl: String(item.fileUrl || item.url || '').trim().slice(0, 1200),
      publicId: String(item.publicId || '').trim().slice(0, 300),
      mimeType: String(item.mimeType || '').trim().slice(0, 120),
      sizeBytes: Number.isFinite(Number(item.sizeBytes)) ? Number(item.sizeBytes) : null,
      uploadedBy: item.uploadedBy || actor,
      createdAt: new Date()
    }))
    .filter((item) => item.fileName);
}

function pickEnum(value, allowed, fallback) {
  const candidate = String(value || '').trim();
  return allowed.includes(candidate) ? candidate : fallback;
}

function ownerSideFromSupportLevel(level) {
  if (level === 'L2') return 'partner';
  if (level === 'L3') return 'suntec';
  return 'client';
}

function cleanStatus(value = {}) {
  return {
    localId: String(value.localId || 'new').trim(),
    name: String(value.name || 'New').trim(),
    customerLabel: String(value.customerLabel || value.name || 'New').trim(),
    statusType: String(value.statusType || 'start').trim(),
    isCustomerVisible: value.isCustomerVisible !== false,
    taskTemplates: Array.isArray(value.taskTemplates) ? value.taskTemplates.map((template, index) => ({
      localId: String(template.localId || `template_${index + 1}`).trim(),
      title: String(template.title || '').trim(),
      description: String(template.description || '').trim(),
      ownerSide: ['client', 'partner', 'suntec', 'internal'].includes(template.ownerSide) ? template.ownerSide : 'suntec',
      queue: String(template.queue || '').trim(),
      isBlocking: template.isBlocking === true,
      visibility: ['client_visible', 'partner_visible', 'internal_only'].includes(template.visibility) ? template.visibility : 'internal_only',
      displayOrder: Number(template.displayOrder) || 100
    })).filter((template) => template.title) : []
  };
}

function cleanWorkflowDefinition(value = {}) {
  const statuses = Array.isArray(value.statuses) ? value.statuses.map(cleanStatus).filter((item) => item.localId) : [];
  const statusIds = new Set(statuses.map((item) => item.localId));
  const transitions = Array.isArray(value.transitions)
    ? value.transitions
        .map((item) => ({ fromStatusId: String(item.fromStatusId || '').trim(), toStatusId: String(item.toStatusId || '').trim() }))
        .filter((item) => statusIds.has(item.fromStatusId) && statusIds.has(item.toStatusId) && item.fromStatusId !== item.toStatusId)
    : [];
  return { statuses, transitions };
}

function cleanSupportPathDefinition(value = {}) {
  const levels = Array.isArray(value.levels)
    ? value.levels
        .map((item) => ({
          localId: String(item.localId || '').trim(),
          label: String(item.label || item.localId || '').trim(),
          ownerSide: ['client', 'partner', 'suntec'].includes(item.ownerSide) ? item.ownerSide : 'client',
          slaApplicable: item.slaApplicable === true,
          displayOrder: Number(item.displayOrder) || 100,
          workflowId: String(item.workflowId || item.workflow?.id || '').trim(),
          workflowName: String(item.workflowName || item.workflow?.name || '').trim(),
          workflow: cleanRef(item.workflow || {}),
          workflowDefinition: cleanWorkflowDefinition(item.workflowDefinition || item.workflow || {})
        }))
        .filter((item) => item.localId)
    : [];
  const levelIds = new Set(levels.map((item) => item.localId));
  const movementRules = Array.isArray(value.movementRules)
    ? value.movementRules
        .map((item) => {
          const toLevelId = String(item.toLevelId || '').trim();
          const toLevelIds = Array.isArray(item.toLevelIds)
            ? [...new Set(item.toLevelIds.map((level) => String(level || '').trim()).filter((level) => levelIds.has(level)))]
            : [];
          const targets = toLevelIds.length ? toLevelIds : (levelIds.has(toLevelId) ? [toLevelId] : []);
          return {
            localId: String(item.localId || '').trim(),
            actionLabel: String(item.actionLabel || '').trim(),
            fromLevelId: String(item.fromLevelId || '').trim(),
            toLevelId: targets[0] || toLevelId,
            movementType: item.movementType === 'parallel' || targets.length > 1 ? 'parallel' : 'sequential',
            toLevelIds: targets,
            primaryLevelId: targets.includes(String(item.primaryLevelId || '').trim()) ? String(item.primaryLevelId || '').trim() : (targets[0] || ''),
            targetStatusBehavior: item.targetStatusBehavior === 'keep' ? 'keep' : 'start',
            commentRequired: item.commentRequired !== false,
            reasonRequired: item.reasonRequired !== false,
            displayOrder: Number(item.displayOrder) || 100
          };
        })
        .filter((item) => item.localId && item.actionLabel && levelIds.has(item.fromLevelId) && item.toLevelIds.length)
    : [];
  return { levels, movementRules };
}

function cleanTask(value = {}, index = 0) {
  return {
    localId: String(value.localId || `task_${index + 1}`).trim().slice(0, 80),
    taskId: String(value.taskId || '').trim().toUpperCase().slice(0, 120),
    title: String(value.title || 'Task').trim().slice(0, 180),
    description: String(value.description || '').trim().slice(0, 1500),
    ownerSide: ['client', 'partner', 'suntec', 'internal'].includes(value.ownerSide) ? value.ownerSide : 'suntec',
    queue: String(value.queue || '').trim().slice(0, 140),
    priority: ['low', 'normal', 'high', 'critical'].includes(value.priority) ? value.priority : 'normal',
    assignedTo: cleanActor(value.assignedTo || {}),
    dueAt: value.dueAt ? new Date(value.dueAt) : null,
    startedAt: value.startedAt ? new Date(value.startedAt) : null,
    status: ['open', 'in_progress', 'blocked', 'done', 'cancelled'].includes(value.status) ? value.status : 'open',
    visibility: ['client_visible', 'partner_visible', 'internal_only'].includes(value.visibility) ? value.visibility : 'internal_only',
    isBlocking: value.isBlocking === true,
    sourceStatusId: String(value.sourceStatusId || '').trim(),
    sourceStatusName: String(value.sourceStatusName || '').trim().slice(0, 120),
    sourceStageId: String(value.sourceStageId || '').trim(),
    createdByAutomation: value.createdByAutomation !== false,
    createdAt: value.createdAt ? new Date(value.createdAt) : new Date(),
    completedAt: value.completedAt ? new Date(value.completedAt) : null,
    completionNote: String(value.completionNote || '').trim().slice(0, 1200),
    completedBy: cleanActor(value.completedBy || {}),
    comments: Array.isArray(value.comments) ? value.comments.map((comment, commentIndex) => ({
      commentId: String(comment.commentId || `comment_${commentIndex + 1}`).trim().slice(0, 80),
      body: String(comment.body || '').trim().slice(0, 5000),
      visibility: ['client_visible', 'partner_visible', 'internal_only'].includes(comment.visibility) ? comment.visibility : 'internal_only',
      author: cleanActor(comment.author || {}),
      attachments: cleanAttachments(comment.attachments || [], comment.author || {}),
      createdAt: comment.createdAt ? new Date(comment.createdAt) : new Date()
    })).filter((comment) => comment.body) : [],
    activity: Array.isArray(value.activity) ? value.activity.map((event) => ({
      eventType: String(event.eventType || 'updated').trim().slice(0, 60),
      message: String(event.message || '').trim().slice(0, 1000),
      actor: cleanActor(event.actor || {}),
      createdAt: event.createdAt ? new Date(event.createdAt) : new Date()
    })) : []
  };
}

function taskDisplayId(requestNumber, sequence) {
  return `${String(requestNumber || 'REQ').toUpperCase()}-T${String(sequence).padStart(3, '0')}`;
}

function ensureTaskIds(requestItem) {
  requestItem.tasks = requestItem.tasks || [];
  let sequence = Math.max(0, Number(requestItem.taskSequence || 0));
  let changed = false;
  for (const task of requestItem.tasks) {
    const existingMatch = String(task.taskId || '').match(/-T(\d+)$/i);
    if (existingMatch) sequence = Math.max(sequence, Number(existingMatch[1]));
  }
  for (const task of requestItem.tasks) {
    if (String(task.taskId || '').trim()) continue;
    sequence += 1;
    task.taskId = taskDisplayId(requestItem.requestNumber, sequence);
    task.activity = task.activity || [];
    task.activity.push({ eventType: 'created', message: `Task ${task.taskId} created from ${task.sourceStatusName || 'workflow status'}.`, actor: {}, createdAt: task.createdAt || new Date() });
    changed = true;
  }
  if (Number(requestItem.taskSequence || 0) !== sequence) {
    requestItem.taskSequence = sequence;
    changed = true;
  }
  return changed;
}


function cleanActiveStage(value = {}, index = 0) {
  const localId = String(value.localId || '').trim();
  const workflowDefinition = cleanWorkflowDefinition(value.workflowDefinition || value.workflow || {});
  return {
    localId: localId || `L${index + 1}`,
    label: String(value.label || localId || `Stage ${index + 1}`).trim(),
    ownerSide: ['client', 'partner', 'suntec'].includes(value.ownerSide) ? value.ownerSide : ownerSideFromSupportLevel(localId || 'L1'),
    isPrimary: value.isPrimary === true,
    assignedTo: cleanActor(value.assignedTo || {}),
    workflow: cleanRef(value.workflow || {}),
    workflowDefinition,
    currentStatus: cleanStatus(value.currentStatus || workflowDefinition.statuses?.find((status) => status.statusType === 'start') || workflowDefinition.statuses?.[0] || {})
  };
}

function isAssignedWorkflowStatus(status = {}) {
  const localId = String(status.localId || '').trim().toLowerCase();
  const name = String(status.name || status.customerLabel || '').trim().toLowerCase();
  return localId === 'assigned' || name === 'assigned' || name.startsWith('assigned ');
}

function startStatusFromWorkflowDefinition(definition = {}) {
  const statuses = definition.statuses || [];
  return cleanStatus(statuses.find((status) => status.statusType === 'start') || statuses[0] || {});
}

function tasksFromStageStatus(stage = {}, statusOverride = null, instanceKey = '') {
  const status = statusOverride ? cleanStatus(statusOverride) : (stage.currentStatus || startStatusFromWorkflowDefinition(stage.workflowDefinition || {}));
  const workflowStatus = (stage.workflowDefinition?.statuses || []).find((item) => item.localId === status.localId) || status || {};
  return (workflowStatus.taskTemplates || []).map((template, index) => cleanTask({
    localId: `${stage.localId}_${status.localId}_${template.localId || index}_${instanceKey || Date.now().toString(36)}_${index}`.replace(/[^A-Za-z0-9_]/g, '_').slice(0, 80),
    title: template.title,
    description: template.description,
    ownerSide: template.ownerSide || stage.ownerSide,
    queue: template.queue,
    visibility: template.visibility,
    isBlocking: template.isBlocking,
    sourceStatusId: status.localId,
    sourceStatusName: status.name || status.customerLabel || status.localId,
    sourceStageId: stage.localId,
    createdByAutomation: true
  }, index));
}

function addStageTasks(requestItem, stage, statusOverride = null) {
  requestItem.tasks = requestItem.tasks || [];
  const generated = tasksFromStageStatus(stage, statusOverride, `${Date.now().toString(36)}_${requestItem.tasks.length}`);
  requestItem.tasks.push(...generated);
  ensureTaskIds(requestItem);
}

function blockingTasksForStageStatus(requestItem, stageId, statusId) {
  return (requestItem.tasks || []).filter((task) => task.sourceStageId === stageId && task.sourceStatusId === statusId && task.isBlocking && !['done', 'cancelled'].includes(task.status));
}

function lifecycleFromActiveStages(stages = []) {
  if (!stages.length) return 'open';
  const types = stages.map((stage) => stage.currentStatus?.statusType || 'normal');
  if (types.every((type) => type === 'cancelled')) return 'cancelled';
  if (types.every((type) => ['final', 'cancelled'].includes(type))) return 'closed';
  if (types.every((type) => ['resolved', 'final', 'cancelled'].includes(type))) return 'resolved';
  return 'open';
}

function lifecycleFromStatus(status) {
  if (status.statusType === 'cancelled') return 'cancelled';
  if (status.statusType === 'final') return 'closed';
  if (status.statusType === 'resolved') return 'resolved';
  return 'open';
}

async function nextRequestNumber(organizationId, clientCode = '') {
  const prefix = String(clientCode || 'REQ').replace(/[^A-Z0-9]/g, '').slice(0, 6) || 'REQ';
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const count = await ServiceRequest.countDocuments({ organizationId });
    const sequence = String(count + attempt + 1).padStart(5, '0');
    const candidate = `${prefix}-${sequence}`;
    const exists = await ServiceRequest.exists({ organizationId, requestNumber: candidate });
    if (!exists) return candidate;
  }
  return `${prefix}-${Date.now().toString().slice(-8)}`;
}

app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'request-service', timestamp: new Date().toISOString() });
});

app.get('/api/organizations/:organizationId/clients/:clientId/usage', async (req, res, next) => {
  try {
    if (!isValidId(req.params.organizationId) || !isValidId(req.params.clientId)) return res.status(400).json({ message: 'Valid organization and client ids are required.' });
    const requestCount = await ServiceRequest.countDocuments({ organizationId: req.params.organizationId, 'client.id': String(req.params.clientId) });
    res.json({ clientId: String(req.params.clientId), requestCount });
  } catch (error) {
    next(error);
  }
});

app.get('/api/organizations/:organizationId/requests', async (req, res, next) => {
  try {
    if (!isValidId(req.params.organizationId)) return res.status(400).json({ message: 'Invalid organization id.' });
    const filter = { organizationId: req.params.organizationId };

    const clientIds = String(req.query.clientIds || '')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
    if (clientIds.length) filter['client.id'] = { $in: clientIds };

    const requesterId = String(req.query.requesterId || '').trim();
    if (requesterId) filter['requester.actorId'] = requesterId;

    const assigneeActorId = String(req.query.assigneeActorId || '').trim();
    const assigneeEmail = String(req.query.assigneeEmail || '').trim().toLowerCase();
    if (assigneeActorId || assigneeEmail) {
      const assigneeOr = [];
      if (assigneeActorId) assigneeOr.push({ 'activeStages.assignedTo.actorId': assigneeActorId });
      if (assigneeEmail) assigneeOr.push({ 'activeStages.assignedTo.email': assigneeEmail });
      filter.$and = [...(filter.$and || []), { $or: assigneeOr }];
    }

    const visibilityScopes = String(req.query.visibilityScopes || '')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
    if (visibilityScopes.length) {
      filter.$or = [{ visibilityScope: { $in: visibilityScopes } }];
      if (visibilityScopes.includes('client_visible')) filter.$or.push({ visibilityScope: { $exists: false } });
    }

    const status = String(req.query.status || '').trim().toLowerCase();
    if (status) {
      if (status === 'open') filter.lifecycleState = { $nin: ['closed', 'cancelled', 'returned'] };
      else if (status === 'closed') filter.lifecycleState = 'closed';
      else filter.$and = [...(filter.$and || []), { $or: [
        { 'currentStatus.name': new RegExp(status, 'i') },
        { 'currentStatus.customerLabel': new RegExp(status, 'i') },
        { lifecycleState: new RegExp(status, 'i') }
      ] }];
    }

    const sla = String(req.query.sla || '').trim().toLowerCase();
    if (sla) filter['sla.rag'] = sla;

    const supportLevel = String(req.query.supportLevel || '').trim().toUpperCase();
    if (['L1','L2','L3'].includes(supportLevel)) filter.currentSupportLevel = supportLevel;

    const visibility = String(req.query.visibility || '').trim();
    if (visibility) filter.visibilityScope = visibility;

    const searchText = String(req.query.search || '').trim();
    if (searchText) {
      const rx = new RegExp(searchText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$and = [...(filter.$and || []), { $or: [
        { requestNumber: rx },
        { subject: rx },
        { 'client.name': rx },
        { 'client.code': rx },
        { 'level1Type.name': rx },
        { 'level2Type.name': rx }
      ] }];
    }

    const dateFrom = req.query.dateFrom ? new Date(req.query.dateFrom) : null;
    const dateTo = req.query.dateTo ? new Date(req.query.dateTo) : null;
    if ((dateFrom && !Number.isNaN(dateFrom.getTime())) || (dateTo && !Number.isNaN(dateTo.getTime()))) {
      filter.createdAt = {};
      if (dateFrom && !Number.isNaN(dateFrom.getTime())) filter.createdAt.$gte = dateFrom;
      if (dateTo && !Number.isNaN(dateTo.getTime())) filter.createdAt.$lte = dateTo;
    }

    const page = Math.max(1, Number.parseInt(req.query.page || '1', 10));
    const pageSize = Math.min(5000, Math.max(1, Number.parseInt(req.query.pageSize || '50', 10)));
    const total = await ServiceRequest.countDocuments(filter);
    const requests = await ServiceRequest.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * pageSize)
      .limit(pageSize);

    res.json({ requests, pagination: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) } });
  } catch (error) {
    next(error);
  }
});

app.post('/api/organizations/:organizationId/requests', async (req, res, next) => {
  try {
    if (!isValidId(req.params.organizationId)) return res.status(400).json({ message: 'Invalid organization id.' });

    const subject = requireText(req.body.subject, 'Subject', 3);
    const description = requireText(req.body.description, 'Description', 10);
    const client = cleanRef(req.body.client);
    const level1Type = cleanRef(req.body.level1Type);
    const level2Type = cleanRef(req.body.level2Type);
    const requester = cleanActor(req.body.requester);

    if (!client.id || !client.name) return res.status(400).json({ message: 'Client is required.' });
    if (!level1Type.id || !level1Type.name) return res.status(400).json({ message: 'Level 1 issue type is required.' });
    if (!level2Type.id || !level2Type.name) return res.status(400).json({ message: 'Level 2 issue type is required.' });
    if (!requester.actorId || !requester.email) return res.status(400).json({ message: 'Requester details are required.' });

    const workflow = cleanRef(req.body.workflow || {});
    const workflowDefinition = cleanWorkflowDefinition(req.body.workflowDefinition || {});
    const supportPath = cleanRef(req.body.supportPath || {});
    const supportPathDefinition = cleanSupportPathDefinition(req.body.supportPathDefinition || {});
    const slaPolicy = cleanRef(req.body.slaPolicy || {});
    const slaDefinition = cleanSlaDefinition(req.body.slaDefinition || {});
    const customFieldValues = cleanCustomFields(req.body.customFieldValues || []);
    const currentStatus = cleanStatus(req.body.currentStatus || workflowDefinition.statuses[0] || {});
    const sourcePortal = ['admin', 'client', 'agent'].includes(req.body.sourcePortal) ? req.body.sourcePortal : requester.portal || 'admin';
    const defaultSource = sourcePortal === 'client'
      ? 'client_portal'
      : requester.userType === 'partnerUser'
        ? 'partner_observed'
        : 'internal_observed';
    const source = pickEnum(req.body.source, ['client_portal', 'client_asked_agent', 'partner_observed', 'internal_observed', 'system_alert'], defaultSource);
    const defaultVisibility = sourcePortal === 'client'
      ? 'client_visible'
      : source === 'client_asked_agent'
        ? 'client_visible'
        : requester.userType === 'partnerUser'
          ? 'partner_visible'
          : 'internal_only';
    const visibilityScope = sourcePortal === 'client'
      ? 'client_visible'
      : pickEnum(req.body.visibilityScope, ['client_visible', 'partner_visible', 'internal_only'], defaultVisibility);
    const currentSupportLevel = sourcePortal === 'client'
      ? 'L1'
      : pickEnum(req.body.currentSupportLevel, ['L1', 'L2', 'L3'], visibilityScope === 'partner_visible' ? 'L2' : 'L3');
    const ownerSide = ownerSideFromSupportLevel(currentSupportLevel);
    let activeStages = Array.isArray(req.body.activeStages) ? req.body.activeStages.map(cleanActiveStage).filter((stage) => stage.localId) : [];
    if (!activeStages.length) {
      const configuredLevel = (supportPathDefinition.levels || []).find((item) => item.localId === currentSupportLevel) || supportPathDefinition.levels?.[0];
      if (configuredLevel) {
        activeStages = [cleanActiveStage({
          ...configuredLevel,
          workflow: configuredLevel.workflow?.id ? configuredLevel.workflow : workflow,
          workflowDefinition: configuredLevel.workflowDefinition?.statuses?.length ? configuredLevel.workflowDefinition : workflowDefinition,
          currentStatus,
          isPrimary: true
        })];
      }
    }
    if (activeStages.length && !activeStages.some((stage) => stage.isPrimary)) activeStages[0].isPrimary = true;
    const primaryStage = activeStages.find((stage) => stage.isPrimary) || activeStages[0] || null;
    const effectiveWorkflow = primaryStage?.workflow?.id ? primaryStage.workflow : workflow;
    const effectiveWorkflowDefinition = primaryStage?.workflowDefinition?.statuses?.length ? primaryStage.workflowDefinition : workflowDefinition;
    const effectiveCurrentStatus = primaryStage?.currentStatus?.localId ? primaryStage.currentStatus : currentStatus;
    const effectiveSupportLevel = primaryStage?.localId || currentSupportLevel;
    const effectiveOwnerSide = primaryStage?.ownerSide || ownerSide;
    const tasks = Array.isArray(req.body.tasks) ? req.body.tasks.map(cleanTask) : activeStages.flatMap((stage, index) => tasksFromStageStatus(stage, null, `create_${index}`));
    const raisedOnBehalfOf = cleanActor(req.body.raisedOnBehalfOf || {});
    const requestNumber = await nextRequestNumber(req.params.organizationId, client.code || 'REQ');
    const taskEnvelope = { requestNumber, tasks, taskSequence: 0 };
    ensureTaskIds(taskEnvelope);

    const request = new ServiceRequest({
      organizationId: req.params.organizationId,
      requestNumber,
      subject,
      description,
      client,
      level1Type,
      level2Type,
      workflow: effectiveWorkflow,
      workflowDefinition: effectiveWorkflowDefinition,
      supportPath,
      supportPathDefinition,
      slaPolicy,
      slaDefinition,
      customFieldValues,
      currentStatus: effectiveCurrentStatus,
      activeStages,
      tasks: taskEnvelope.tasks,
      taskSequence: taskEnvelope.taskSequence,
      severity: cleanRef(req.body.severity || {}),
      priority: cleanRef(req.body.priority || {}),
      product: cleanRef(req.body.product || {}),
      module: cleanRef(req.body.module || {}),
      modules: Array.isArray(req.body.modules) ? req.body.modules.map((item) => cleanRef(item)).filter((item) => item.id || item.name) : [],
      region: cleanRef(req.body.region || {}),
      environment: cleanRef(req.body.environment || {}),
      attachments: cleanAttachments(req.body.attachments || [], requester),
      requester,
      raisedOnBehalfOf,
      sourcePortal,
      source,
      visibilityScope,
      currentSupportLevel: effectiveSupportLevel,
      ownerSide: effectiveOwnerSide,
      timeline: [
        {
          eventType: 'created',
          message: raisedOnBehalfOf.name || raisedOnBehalfOf.email
            ? `${requester.name || requester.email} created this request on behalf of ${raisedOnBehalfOf.name || raisedOnBehalfOf.email} for ${client.name}.`
            : `${requester.name || requester.email} created this request for ${client.name}.`,
          actor: requester,
          createdAt: new Date()
        },
        {
          eventType: 'origin_visibility_set',
          message: `Origin: ${source.replaceAll('_', ' ')} · Visibility: ${visibilityScope.replaceAll('_', ' ')} · Support level: ${effectiveSupportLevel}.`,
          actor: requester,
          createdAt: new Date()
        },
        {
          eventType: 'status_set',
          message: `Request created with status ${effectiveCurrentStatus.name || 'New'}.`,
          actor: requester,
          createdAt: new Date()
        },
        ...cleanAttachments(req.body.attachments || [], requester).map((attachment) => ({
          eventType: 'attachment_added',
          message: `Attachment added: ${attachment.fileName}.`,
          actor: requester,
          createdAt: new Date()
        }))
      ]
    });

    const previousSla = request.sla ? request.sla.toObject?.() || request.sla : {};
    syncSlaState(request);
    const slaMessage = slaHistoryMessage(previousSla, request.sla);
    if (slaMessage) request.timeline.push({ eventType: 'sla_calculated', message: slaMessage, actor: requester, createdAt: new Date() });
    await request.save();

    res.status(201).json({ request });
  } catch (error) {
    next(error);
  }
});


app.post('/api/organizations/:organizationId/requests/:requestId/status', async (req, res, next) => {
  try {
    if (!isValidId(req.params.organizationId) || !isValidId(req.params.requestId)) return res.status(400).json({ message: 'Invalid request id.' });
    const requestItem = await ServiceRequest.findOne({ _id: req.params.requestId, organizationId: req.params.organizationId });
    if (!requestItem) return res.status(404).json({ message: 'Request not found.' });

    const requestedStageId = String(req.body.stageId || '').trim();
    const activeStages = requestItem.activeStages || [];
    if (requestedStageId && activeStages.length && !activeStages.some((item) => item.localId === requestedStageId)) {
      return res.status(400).json({ message: 'The selected support stage is not active on this request.' });
    }
    const stage = activeStages.find((item) => item.localId === requestedStageId)
      || activeStages.find((item) => item.isPrimary)
      || activeStages[0]
      || null;
    const supplied = cleanWorkflowDefinition(req.body.workflowDefinition || {});
    const stageDefinition = cleanWorkflowDefinition(stage?.workflowDefinition || {});
    const storedDefinition = cleanWorkflowDefinition(requestItem.workflowDefinition || {});
    const definition = stageDefinition.statuses.length ? stageDefinition : (storedDefinition.statuses.length ? storedDefinition : supplied);
    if (stage && !stage.workflowDefinition?.statuses?.length && definition.statuses.length) stage.workflowDefinition = definition;
    if ((!requestItem.workflowDefinition?.statuses?.length) && definition.statuses.length && (!stage || stage.isPrimary)) requestItem.workflowDefinition = definition;

    const toStatusId = String(req.body.toStatusId || '').trim();
    const target = (definition.statuses || []).find((item) => item.localId === toStatusId);
    if (!target) return res.status(400).json({ message: 'Target status is not available in this workflow.' });
    const currentStatus = stage?.currentStatus || requestItem.currentStatus || {};
    const currentId = currentStatus.localId || '';
    const expectedFromStatusId = String(req.body.expectedFromStatusId || '').trim();
    const allowedNextStatuses = (definition.transitions || [])
      .filter((item) => item.fromStatusId === currentId)
      .map((item) => (definition.statuses || []).find((status) => status.localId === item.toStatusId))
      .filter(Boolean)
      .map(cleanStatus);

    if (toStatusId === currentId) {
      return res.json({
        request: requestItem,
        noChange: true,
        message: `The ${stage?.label || stage?.localId || 'request'} stage is already at ${currentStatus.name || currentId}.`
      });
    }

    if (expectedFromStatusId && expectedFromStatusId !== currentId) {
      return res.status(409).json({
        code: 'STALE_WORKFLOW_STATUS',
        message: `This request changed after the page was opened. Its current status is ${currentStatus.name || currentId}. Refresh the request and choose one of the available next statuses.`,
        currentStatus: cleanStatus(currentStatus),
        allowedNextStatuses
      });
    }

    const allowed = (definition.transitions || []).some((item) => item.fromStatusId === currentId && item.toStatusId === toStatusId);
    const actor = cleanActor(req.body.actor || {});
    const adminOverride = actor.portal === 'admin';
    if (!allowed && !adminOverride) {
      return res.status(400).json({
        code: 'WORKFLOW_TRANSITION_NOT_ALLOWED',
        message: `The workflow does not allow ${currentStatus.name || currentId} → ${target.name}. Refresh the request and choose one of the configured next statuses.`,
        currentStatus: cleanStatus(currentStatus),
        allowedNextStatuses
      });
    }
    if (stage) {
      const blockers = blockingTasksForStageStatus(requestItem, stage.localId, currentId);
      if (blockers.length) return res.status(400).json({ message: `Complete ${blockers.length} blocking task${blockers.length === 1 ? '' : 's'} before moving this stage.` });
      if (req.body.assignedTo !== undefined) stage.assignedTo = cleanActor(req.body.assignedTo || {});
      if (isAssignedWorkflowStatus(target) && !(stage.assignedTo?.actorId || stage.assignedTo?.email)) {
        return res.status(400).json({ message: `Assign ${stage.label || stage.localId} to an eligible user before moving it to Assigned.` });
      }
    }

    const comment = requireText(req.body.comment, 'Comment', 3);
    const previousStatusName = currentStatus.name || currentId;
    const cleanedTarget = cleanStatus(target);
    if (stage) {
      stage.currentStatus = cleanedTarget;
      addStageTasks(requestItem, stage, cleanedTarget);
      if (stage.isPrimary) {
        const targetIsTerminal = ['resolved', 'final', 'cancelled'].includes(cleanedTarget.statusType);
        const unfinishedAlternative = targetIsTerminal
          ? activeStages.find((item) => item.localId !== stage.localId && !['resolved', 'final', 'cancelled'].includes(item.currentStatus?.statusType))
          : null;
        if (unfinishedAlternative) {
          activeStages.forEach((item) => { item.isPrimary = item.localId === unfinishedAlternative.localId; });
          requestItem.currentSupportLevel = unfinishedAlternative.localId;
          requestItem.ownerSide = unfinishedAlternative.ownerSide;
          requestItem.currentStatus = unfinishedAlternative.currentStatus;
          requestItem.workflow = unfinishedAlternative.workflow?.id ? unfinishedAlternative.workflow : requestItem.workflow;
          requestItem.workflowDefinition = unfinishedAlternative.workflowDefinition?.statuses?.length ? unfinishedAlternative.workflowDefinition : requestItem.workflowDefinition;
        } else {
          requestItem.currentStatus = cleanedTarget;
          requestItem.workflow = stage.workflow?.id ? stage.workflow : requestItem.workflow;
          requestItem.workflowDefinition = stage.workflowDefinition?.statuses?.length ? stage.workflowDefinition : requestItem.workflowDefinition;
        }
      }
      requestItem.lifecycleState = lifecycleFromActiveStages(activeStages);
    } else {
      requestItem.currentStatus = cleanedTarget;
      requestItem.lifecycleState = lifecycleFromStatus(target);
    }
    const stageLabel = stage ? ` in ${stage.label || stage.localId}` : '';
    requestItem.timeline.push({ eventType: 'status_changed', message: `Status changed${stageLabel} from ${previousStatusName} to ${target.name}. ${comment}`, actor, createdAt: new Date() });
    const previousSla = requestItem.sla ? requestItem.sla.toObject?.() || requestItem.sla : {};
    syncSlaState(requestItem);
    const slaMessage = slaHistoryMessage(previousSla, requestItem.sla);
    if (slaMessage) requestItem.timeline.push({ eventType: 'sla_calculated', message: slaMessage, actor, createdAt: new Date() });
    await requestItem.save();
    res.json({ request: requestItem });
  } catch (error) { next(error); }
});

app.post('/api/organizations/:organizationId/requests/:requestId/stages/:stageId/assignee', async (req, res, next) => {
  try {
    if (!isValidId(req.params.organizationId) || !isValidId(req.params.requestId)) return res.status(400).json({ message: 'Invalid request id.' });
    const requestItem = await ServiceRequest.findOne({ _id: req.params.requestId, organizationId: req.params.organizationId });
    if (!requestItem) return res.status(404).json({ message: 'Request not found.' });
    const stageId = String(req.params.stageId || '').trim();
    const stage = (requestItem.activeStages || []).find((item) => item.localId === stageId);
    if (!stage) return res.status(404).json({ message: 'Active support stage not found.' });
    const actor = cleanActor(req.body.actor || {});
    const assignedTo = cleanActor(req.body.assignedTo || {});
    const previous = stage.assignedTo?.name || stage.assignedTo?.email || 'Unassigned';
    stage.assignedTo = assignedTo;
    const next = assignedTo.name || assignedTo.email || 'Unassigned';
    requestItem.timeline.push({
      eventType: assignedTo.actorId || assignedTo.email ? 'stage_assigned' : 'stage_unassigned',
      message: `${stage.label || stage.localId} assignment changed from ${previous} to ${next}.`,
      actor,
      createdAt: new Date()
    });
    await requestItem.save();
    res.json({ request: requestItem, stage });
  } catch (error) { next(error); }
});

app.post('/api/organizations/:organizationId/requests/:requestId/support-move', async (req, res, next) => {
  try {
    if (!isValidId(req.params.organizationId) || !isValidId(req.params.requestId)) return res.status(400).json({ message: 'Invalid request id.' });
    const requestItem = await ServiceRequest.findOne({ _id: req.params.requestId, organizationId: req.params.organizationId });
    if (!requestItem) return res.status(404).json({ message: 'Request not found.' });

    const suppliedPath = cleanSupportPathDefinition(req.body.supportPathDefinition || {});
    const storedPath = cleanSupportPathDefinition(requestItem.supportPathDefinition || {});
    const definition = suppliedPath.levels.length ? suppliedPath : storedPath;
    if (suppliedPath.levels.length) {
      // Support paths are live configuration. Refresh the request snapshot when the
      // workbench supplies a newer definition so existing requests can use newly
      // configured return routes and current stage ownership without a migration.
      requestItem.supportPathDefinition = suppliedPath;
    }
    const expectedFromLevelId = String(req.body.expectedFromLevelId || '').trim();
    const activeStages = requestItem.activeStages || [];
    const sourceStage = expectedFromLevelId
      ? activeStages.find((item) => item.localId === expectedFromLevelId)
      : (activeStages.find((item) => item.isPrimary) || activeStages[0] || null);
    if (expectedFromLevelId && !sourceStage) {
      return res.status(409).json({
        code: 'STALE_SUPPORT_LEVEL',
        message: `${expectedFromLevelId} is no longer an active support stage. Refresh the request before routing it.`,
        currentSupportLevel: requestItem.currentSupportLevel || ''
      });
    }
    const fromLevelId = sourceStage?.localId || requestItem.currentSupportLevel || '';
    const ruleId = String(req.body.ruleId || '').trim();
    const rule = (definition.movementRules || []).find((item) => item.localId === ruleId && item.fromLevelId === fromLevelId);
    if (!rule) return res.status(400).json({ message: 'This support movement is not available from the selected active support stage. Refresh the request and try again.' });
    const currentStage = sourceStage
      || activeStages.find((item) => item.localId === requestItem.currentSupportLevel)
      || activeStages.find((item) => item.isPrimary)
      || null;
    if (currentStage) {
      const blockers = blockingTasksForStageStatus(requestItem, currentStage.localId, currentStage.currentStatus?.localId || '');
      if (blockers.length) return res.status(400).json({ message: `Complete ${blockers.length} blocking task${blockers.length === 1 ? '' : 's'} before moving this stage.` });
    }
    const targetLevelIds = rule.movementType === 'parallel' && rule.toLevelIds?.length ? rule.toLevelIds : [rule.toLevelId];
    const targetLevels = targetLevelIds.map((levelId) => (definition.levels || []).find((item) => item.localId === levelId)).filter(Boolean);
    if (!targetLevels.length) return res.status(400).json({ message: 'Target support level is not configured.' });
    const comment = rule.commentRequired ? requireText(req.body.comment, 'Comment', 3) : String(req.body.comment || '').trim();
    const reason = rule.reasonRequired ? requireText(req.body.reason, 'Reason', 2) : String(req.body.reason || '').trim();
    const actor = cleanActor(req.body.actor || {});
    const fromLevel = fromLevelId;
    const primaryLevel = targetLevels.find((level) => level.localId === rule.primaryLevelId) || targetLevels[0];
    const newStages = targetLevels.map((level) => {
      const levelDefinition = cleanWorkflowDefinition(level.workflowDefinition || level.workflow || {});
      const fallbackDefinition = cleanWorkflowDefinition(requestItem.workflowDefinition || {});
      const workflowDefinition = levelDefinition.statuses.length ? levelDefinition : fallbackDefinition;
      const compatibleStatus = (workflowDefinition.statuses || []).find((status) => status.localId === requestItem.currentStatus?.localId);
      const stageStatus = rule.targetStatusBehavior === 'keep' && compatibleStatus
        ? cleanStatus(compatibleStatus)
        : startStatusFromWorkflowDefinition(workflowDefinition);
      return cleanActiveStage({
        ...level,
        workflow: level.workflow?.id ? level.workflow : { id: level.workflowId || '', name: level.workflowName || '' },
        workflowDefinition,
        currentStatus: stageStatus,
        isPrimary: level.localId === primaryLevel.localId
      });
    });
    requestItem.activeStages = newStages;
    newStages.forEach((stage) => addStageTasks(requestItem, stage));
    requestItem.currentSupportLevel = primaryLevel.localId;
    requestItem.ownerSide = primaryLevel.ownerSide;
    const primaryStage = newStages.find((stage) => stage.isPrimary) || newStages[0];
    requestItem.workflow = primaryStage.workflow?.id ? primaryStage.workflow : requestItem.workflow;
    requestItem.workflowDefinition = primaryStage.workflowDefinition?.statuses?.length ? primaryStage.workflowDefinition : requestItem.workflowDefinition;
    requestItem.currentStatus = primaryStage.currentStatus || requestItem.currentStatus;
    requestItem.lifecycleState = 'open';
    const movementLabel = targetLevels.map((level) => level.localId).join(rule.movementType === 'parallel' ? ' + ' : ', ');
    requestItem.timeline.push({ eventType: rule.movementType === 'parallel' ? 'parallel_support_started' : 'support_level_changed', message: `${rule.actionLabel}: ${fromLevel} → ${movementLabel}. Reason: ${reason}.${comment ? ` ${comment}` : ''}`, actor, createdAt: new Date() });
    const previousSla = requestItem.sla ? requestItem.sla.toObject?.() || requestItem.sla : {};
    syncSlaState(requestItem);
    const slaMessage = slaHistoryMessage(previousSla, requestItem.sla);
    if (slaMessage) requestItem.timeline.push({ eventType: 'sla_calculated', message: slaMessage, actor, createdAt: new Date() });
    await requestItem.save();
    res.json({ request: requestItem });
  } catch (error) { next(error); }
});

app.post('/api/organizations/:organizationId/requests/:requestId/tasks/:taskId/status', async (req, res, next) => {
  try {
    if (!isValidId(req.params.organizationId) || !isValidId(req.params.requestId)) return res.status(400).json({ message: 'Invalid request id.' });
    const requestItem = await ServiceRequest.findOne({ _id: req.params.requestId, organizationId: req.params.organizationId });
    if (!requestItem) return res.status(404).json({ message: 'Request not found.' });
    const task = (requestItem.tasks || []).find((item) => item.localId === String(req.params.taskId || '').trim());
    if (!task) return res.status(404).json({ message: 'Task not found.' });
    const nextStatus = pickEnum(req.body.status, ['open', 'in_progress', 'blocked', 'done', 'cancelled'], task.status || 'open');
    const actor = cleanActor(req.body.actor || {});
    const previousStatus = task.status;
    const completionNote = String(req.body.note || '').trim().slice(0, 1200);
    if (['done', 'cancelled'].includes(nextStatus) && completionNote.length < 3) {
      return res.status(400).json({ message: 'A completion note of at least 3 characters is required to complete or cancel a task.' });
    }
    ensureTaskIds(requestItem);
    task.status = nextStatus;
    if (req.body.priority !== undefined) task.priority = pickEnum(req.body.priority, ['low', 'normal', 'high', 'critical'], task.priority || 'normal');
    if (req.body.queue !== undefined) task.queue = String(req.body.queue || '').trim().slice(0, 140);
    if (req.body.assignedTo !== undefined) task.assignedTo = cleanActor(req.body.assignedTo || {});
    if (req.body.dueAt !== undefined) {
      const due = req.body.dueAt ? new Date(req.body.dueAt) : null;
      task.dueAt = due && !Number.isNaN(due.getTime()) ? due : null;
    }
    if (nextStatus === 'in_progress' && !task.startedAt) task.startedAt = new Date();
    task.completedAt = ['done', 'cancelled'].includes(nextStatus) ? new Date() : null;
    task.completionNote = completionNote;
    task.completedBy = ['done', 'cancelled'].includes(nextStatus) ? actor : {};
    task.activity = task.activity || [];
    const noteSuffix = completionNote ? ` Note: ${completionNote}` : '';
    const assignmentSuffix = task.assignedTo?.name || task.assignedTo?.email ? ` Assigned to ${task.assignedTo.name || task.assignedTo.email}.` : '';
    task.activity.push({ eventType: 'status_changed', message: `Status changed from ${previousStatus} to ${nextStatus}.${assignmentSuffix}${noteSuffix}`, actor, createdAt: new Date() });
    requestItem.timeline.push({ eventType: 'task_status_changed', message: `${task.taskId || task.title}: changed from ${previousStatus} to ${nextStatus}.${noteSuffix}`, actor, createdAt: new Date() });
    await requestItem.save();
    res.json({ request: requestItem, task });
  } catch (error) { next(error); }
});

app.post('/api/organizations/:organizationId/requests/:requestId/close', async (req, res, next) => {
  try {
    if (!isValidId(req.params.organizationId) || !isValidId(req.params.requestId)) return res.status(400).json({ message: 'Invalid request id.' });
    const requestItem = await ServiceRequest.findOne({ _id: req.params.requestId, organizationId: req.params.organizationId });
    if (!requestItem) return res.status(404).json({ message: 'Request not found.' });
    if (requestItem.lifecycleState === 'closed') return res.json({ request: requestItem });
    const openBlockingTasks = (requestItem.tasks || []).filter((task) => task.isBlocking && !['done', 'cancelled'].includes(task.status));
    if (openBlockingTasks.length) return res.status(400).json({ message: `Complete ${openBlockingTasks.length} blocking task${openBlockingTasks.length === 1 ? '' : 's'} before closing this request.` });
    if ((requestItem.activeStages || []).length > 1 || ['L2', 'L3'].includes(requestItem.currentSupportLevel)) {
      const unfinishedStages = (requestItem.activeStages || []).filter((stage) => !['resolved', 'final', 'cancelled'].includes(stage.currentStatus?.statusType));
      if (unfinishedStages.length) return res.status(400).json({ message: `Complete or resolve all active support stages before closing. Pending: ${unfinishedStages.map((stage) => stage.label || stage.localId).join(', ')}.` });
    }
    const comment = requireText(req.body.comment, 'Closure comment', 3);
    const actor = cleanActor(req.body.actor || {});
    const finalStatus = (requestItem.workflowDefinition?.statuses || []).find((item) => item.statusType === 'final')
      || (requestItem.workflowDefinition?.statuses || []).find((item) => String(item.name || '').toLowerCase().includes('closed'))
      || { localId: 'closed', name: 'Closed', customerLabel: 'Closed', statusType: 'final', isCustomerVisible: true };
    const cleanedFinalStatus = cleanStatus(finalStatus);
    requestItem.currentStatus = cleanedFinalStatus;
    (requestItem.activeStages || []).forEach((stage) => {
      const stageFinal = (stage.workflowDefinition?.statuses || []).find((item) => item.statusType === 'final') || cleanedFinalStatus;
      stage.currentStatus = cleanStatus(stageFinal);
    });
    requestItem.lifecycleState = 'closed';
    requestItem.timeline.push({ eventType: 'closed', message: `Request closed at ${requestItem.currentSupportLevel || 'current level'}. ${comment}`, actor, createdAt: new Date() });
    const previousSla = requestItem.sla ? requestItem.sla.toObject?.() || requestItem.sla : {};
    syncSlaState(requestItem);
    const slaMessage = slaHistoryMessage(previousSla, requestItem.sla);
    if (slaMessage) requestItem.timeline.push({ eventType: 'sla_calculated', message: slaMessage, actor, createdAt: new Date() });
    await requestItem.save();
    res.json({ request: requestItem });
  } catch (error) { next(error); }
});



app.post('/api/organizations/:organizationId/requests/:requestId/return', async (req, res, next) => {
  try {
    if (!isValidId(req.params.organizationId) || !isValidId(req.params.requestId)) return res.status(400).json({ message: 'Invalid request id.' });
    const requestItem = await ServiceRequest.findOne({ _id: req.params.requestId, organizationId: req.params.organizationId });
    if (!requestItem) return res.status(404).json({ message: 'Request not found.' });
    if (!['L2', 'L3'].includes(String(requestItem.currentSupportLevel || ''))) {
      return res.status(400).json({ message: 'Only L2 or L3 requests can be returned by support.' });
    }
    const reason = requireText(req.body.reason, 'Return reason', 2);
    const comment = requireText(req.body.comment, 'Return comment', 3);
    const visibility = pickEnum(req.body.visibility, ['client_visible', 'partner_visible', 'internal_only'], 'client_visible');
    const actor = cleanActor(req.body.actor || {});
    const now = new Date();
    requestItem.lifecycleState = 'returned';
    requestItem.timeline.push({ eventType: 'returned', message: `Request returned. Reason: ${reason}. ${comment}`, actor, createdAt: now });
    requestItem.comments.push({
      commentId: new mongoose.Types.ObjectId().toString(),
      body: `Returned request. Reason: ${reason}. ${comment}`,
      visibility,
      author: actor,
      attachments: [],
      countsAsResponse: false,
      countsAsUpdate: visibility === 'client_visible',
      createdAt: now
    });
    const previousSla = requestItem.sla ? requestItem.sla.toObject?.() || requestItem.sla : {};
    syncSlaState(requestItem);
    const slaMessage = slaHistoryMessage(previousSla, requestItem.sla);
    if (slaMessage) requestItem.timeline.push({ eventType: 'sla_calculated', message: slaMessage, actor, createdAt: new Date() });
    await requestItem.save();
    res.json({ request: requestItem });
  } catch (error) { next(error); }
});

app.post('/api/organizations/:organizationId/requests/:requestId/acknowledge', async (req, res, next) => {
  try {
    if (!isValidId(req.params.organizationId) || !isValidId(req.params.requestId)) return res.status(400).json({ message: 'Invalid request id.' });
    const requestItem = await ServiceRequest.findOne({ _id: req.params.requestId, organizationId: req.params.organizationId });
    if (!requestItem) return res.status(404).json({ message: 'Request not found.' });
    const actor = cleanActor(req.body.actor || {});
    const comment = String(req.body.comment || '').trim();
    const now = new Date();
    if (requestItem.slaMilestones?.response?.actualAt) {
      return res.json({ request: requestItem, message: 'Response already acknowledged.' });
    }
    markResponseMet(requestItem, actor, 'acknowledge', now);
    requestItem.timeline.push({ eventType: 'acknowledged', message: comment ? `Request acknowledged. ${comment}` : 'Request acknowledged.', actor, createdAt: now });
    const previousSla = requestItem.sla ? requestItem.sla.toObject?.() || requestItem.sla : {};
    syncSlaState(requestItem);
    const slaMessage = slaHistoryMessage(previousSla, requestItem.sla);
    if (slaMessage) requestItem.timeline.push({ eventType: 'sla_calculated', message: slaMessage, actor, createdAt: new Date() });
    await requestItem.save();
    res.json({ request: requestItem });
  } catch (error) { next(error); }
});


function taskVisibilityAllowed(task, visibilityScopes = []) {
  if (!visibilityScopes.length) return true;
  return visibilityScopes.includes(String(task.visibility || 'internal_only'));
}

function taskMatchesFilters(task, requestItem, query = {}) {
  const search = String(query.search || '').trim().toLowerCase();
  const status = String(query.status || '').trim();
  const supportLevel = String(query.supportLevel || '').trim().toUpperCase();
  const clientId = String(query.clientId || '').trim();
  const blocking = String(query.blocking || '').trim();
  const visibilityScopes = String(query.visibilityScopes || '').split(',').map((value) => value.trim()).filter(Boolean);
  if (status && task.status !== status) return false;
  if (supportLevel && String(task.sourceStageId || '').toUpperCase() !== supportLevel) return false;
  if (clientId && String(requestItem.client?.id || '') !== clientId) return false;
  if (blocking === 'true' && task.isBlocking !== true) return false;
  if (blocking === 'false' && task.isBlocking === true) return false;
  if (!taskVisibilityAllowed(task, visibilityScopes)) return false;
  if (search) {
    const haystack = [task.taskId, task.title, task.description, task.queue, task.assignedTo?.name, task.assignedTo?.email, requestItem.requestNumber, requestItem.subject, requestItem.client?.name, task.sourceStageId, task.sourceStatusName].join(' ').toLowerCase();
    if (!haystack.includes(search)) return false;
  }
  return true;
}

function taskListItem(requestItem, task) {
  return {
    ...cleanTask(task),
    requestId: String(requestItem._id),
    requestNumber: requestItem.requestNumber,
    requestSubject: requestItem.subject,
    client: cleanRef(requestItem.client || {}),
    lifecycleState: requestItem.lifecycleState,
    requestVisibilityScope: requestItem.visibilityScope,
    currentSupportLevel: requestItem.currentSupportLevel,
    workflow: cleanRef(requestItem.workflow || {})
  };
}

app.get('/api/organizations/:organizationId/tasks', async (req, res, next) => {
  try {
    if (!isValidId(req.params.organizationId)) return res.status(400).json({ message: 'Invalid organization id.' });
    const requests = await ServiceRequest.find({ organizationId: req.params.organizationId, 'tasks.0': { $exists: true } }).sort({ updatedAt: -1 });
    const items = [];
    for (const requestItem of requests) {
      const changed = ensureTaskIds(requestItem);
      for (const task of requestItem.tasks || []) {
        if (taskMatchesFilters(task, requestItem, req.query)) items.push(taskListItem(requestItem, task));
      }
      if (changed) await requestItem.save();
    }
    items.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(200, Math.max(1, Number(req.query.pageSize) || 50));
    const start = (page - 1) * pageSize;
    res.json({ tasks: items.slice(start, start + pageSize), pagination: { page, pageSize, total: items.length, totalPages: Math.max(1, Math.ceil(items.length / pageSize)) } });
  } catch (error) { next(error); }
});

app.get('/api/organizations/:organizationId/tasks/:taskId', async (req, res, next) => {
  try {
    if (!isValidId(req.params.organizationId)) return res.status(400).json({ message: 'Invalid organization id.' });
    const publicTaskId = String(req.params.taskId || '').trim().toUpperCase();
    let requestItem = await ServiceRequest.findOne({ organizationId: req.params.organizationId, 'tasks.taskId': publicTaskId });
    if (!requestItem) {
      const legacy = await ServiceRequest.find({ organizationId: req.params.organizationId, 'tasks.0': { $exists: true } });
      for (const candidate of legacy) {
        const changed = ensureTaskIds(candidate);
        if (changed) await candidate.save();
        if ((candidate.tasks || []).some((task) => task.taskId === publicTaskId)) { requestItem = candidate; break; }
      }
    }
    if (!requestItem) return res.status(404).json({ message: 'Task not found.' });
    const task = (requestItem.tasks || []).find((item) => item.taskId === publicTaskId);
    if (!task) return res.status(404).json({ message: 'Task not found.' });
    res.json({ request: requestItem, task });
  } catch (error) { next(error); }
});

app.post('/api/organizations/:organizationId/tasks/:taskId/comments', async (req, res, next) => {
  try {
    if (!isValidId(req.params.organizationId)) return res.status(400).json({ message: 'Invalid organization id.' });
    const publicTaskId = String(req.params.taskId || '').trim().toUpperCase();
    const requestItem = await ServiceRequest.findOne({ organizationId: req.params.organizationId, 'tasks.taskId': publicTaskId });
    if (!requestItem) return res.status(404).json({ message: 'Task not found.' });
    const task = (requestItem.tasks || []).find((item) => item.taskId === publicTaskId);
    if (!task) return res.status(404).json({ message: 'Task not found.' });
    const body = requireText(req.body.body, 'Comment', 3);
    const visibility = pickEnum(req.body.visibility, ['client_visible', 'partner_visible', 'internal_only'], 'internal_only');
    const actor = cleanActor(req.body.actor || {});
    const createdAt = new Date();
    const attachments = cleanAttachments(req.body.attachments || [], actor);
    const comment = { commentId: new mongoose.Types.ObjectId().toString(), body, visibility, author: actor, attachments, createdAt };
    task.comments = task.comments || [];
    task.comments.push(comment);
    task.activity = task.activity || [];
    task.activity.push({ eventType: 'comment_added', message: `${actor.name || actor.email || 'User'} added a ${visibility.replaceAll('_', ' ')} comment.`, actor, createdAt });
    requestItem.timeline.push({ eventType: 'task_comment_added', message: `${task.taskId}: task comment added.`, actor, createdAt });
    if (req.body.alsoPostToRequest === true || req.body.alsoPostToRequest === 'true' || req.body.alsoPostToRequest === 'on') {
      const requestCommentId = new mongoose.Types.ObjectId().toString();
      const countsAsUpdate = visibility === 'client_visible' && actor.portal !== 'client' && actor.userType !== 'clientUser';
      requestItem.comments = requestItem.comments || [];
      requestItem.comments.push({ commentId: requestCommentId, body: `[${task.taskId}] ${body}`, visibility, author: actor, attachments, countsAsResponse: false, countsAsUpdate, createdAt });
      if (countsAsUpdate) markPublicUpdate(requestItem, actor, requestCommentId, createdAt);
      requestItem.timeline.push({ eventType: 'comment_added', message: `${task.taskId}: task update also posted to the parent request.`, actor, createdAt });
    }
    await requestItem.save();
    res.status(201).json({ request: requestItem, task, comment });
  } catch (error) { next(error); }
});

app.post('/api/organizations/:organizationId/requests/:requestId/comments', async (req, res, next) => {
  try {
    if (!isValidId(req.params.organizationId) || !isValidId(req.params.requestId)) return res.status(400).json({ message: 'Invalid request id.' });
    const requestItem = await ServiceRequest.findOne({ _id: req.params.requestId, organizationId: req.params.organizationId });
    if (!requestItem) return res.status(404).json({ message: 'Request not found.' });
    const body = requireText(req.body.body, 'Comment', 2);
    const actor = cleanActor(req.body.actor || {});
    const visibility = pickEnum(req.body.visibility, ['client_visible', 'partner_visible', 'internal_only'], 'client_visible');
    const now = new Date();
    const supportSide = actor.portal !== 'client' && actor.userType !== 'clientUser';
    const countsAsResponse = supportSide && visibility === 'client_visible' && !requestItem.slaMilestones?.response?.actualAt;
    const countsAsUpdate = supportSide && visibility === 'client_visible';
    const commentId = new mongoose.Types.ObjectId().toString();
    const comment = {
      commentId,
      body,
      visibility,
      author: actor,
      attachments: cleanAttachments(req.body.attachments || [], actor),
      countsAsResponse,
      countsAsUpdate,
      createdAt: now
    };
    requestItem.comments.push(comment);
    if (countsAsResponse) markResponseMet(requestItem, actor, commentId, now);
    if (countsAsUpdate) markPublicUpdate(requestItem, actor, commentId, now);
    const visibilityLabel = visibility === 'client_visible' ? 'public reply' : visibility === 'partner_visible' ? 'partner note' : 'internal note';
    requestItem.timeline.push({ eventType: 'comment_added', message: `${actor.name || actor.email || 'User'} added a ${visibilityLabel}.`, actor, createdAt: now });
    const previousSla = requestItem.sla ? requestItem.sla.toObject?.() || requestItem.sla : {};
    syncSlaState(requestItem);
    const slaMessage = slaHistoryMessage(previousSla, requestItem.sla);
    if (slaMessage) requestItem.timeline.push({ eventType: 'sla_calculated', message: slaMessage, actor, createdAt: new Date() });
    await requestItem.save();
    res.status(201).json({ request: requestItem, comment });
  } catch (error) { next(error); }
});

app.get('/api/organizations/:organizationId/requests/:requestId', async (req, res, next) => {
  try {
    if (!isValidId(req.params.organizationId) || !isValidId(req.params.requestId)) {
      return res.status(400).json({ message: 'Invalid request id.' });
    }
    const request = await ServiceRequest.findOne({ _id: req.params.requestId, organizationId: req.params.organizationId });
    if (!request) return res.status(404).json({ message: 'Request not found.' });
    syncSlaState(request);
    ensureTaskIds(request);
    await request.save();
    res.json({ request });
  } catch (error) {
    next(error);
  }
});

app.use((req, res) => {
  res.status(404).json({ message: 'Route not found.' });
});

app.use((error, req, res, next) => {
  console.error({
    requestId: req.context?.requestId,
    message: error.message,
    stack: config.env === 'development' ? error.stack : undefined
  });

  if (error.name === 'ValidationError') {
    return res.status(400).json({ message: Object.values(error.errors).map((item) => item.message).join(' ') });
  }
  if (error.code === 11000) {
    return res.status(409).json({ message: 'A request with this unique value already exists.' });
  }
  if (error.status) return res.status(error.status).json({ message: error.message });
  res.status(500).json({ message: 'Request service error.' });
});

const server = app.listen(config.port, async () => {
  try {
    await connectDatabase();
    console.log(`Request service running on http://localhost:${config.port}`);
  } catch (error) {
    console.error('Request service failed to connect to MongoDB:', error.message);
    process.exitCode = 1;
    server.close();
  }
});

async function shutdown() {
  console.log('Request service shutting down...');
  await disconnectDatabase();
  server.close(() => process.exit(0));
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
