const { SlaPolicy, MATCH_ANY, AGREEMENT_TYPES, TIME_UNITS } = require('./sla-policy.model');
const { Entity } = require('../entities/entity.model');

function addMinutes(date, minutes) {
  return new Date(date.getTime() + (Number(minutes || 0) * 60 * 1000));
}
function normalizeMinutes(value, unit = 'MINUTES') {
  const numeric = Number(value || 0);
  if (unit === 'DAYS') return numeric * 24 * 60;
  if (unit === 'HOURS') return numeric * 60;
  return numeric;
}
function getMetricMinutes(metricTargets = [], metricType, fallbackMinutes = null) {
  const found = metricTargets.find((item) => item.metricType === metricType);
  if (!found) return fallbackMinutes;
  return Number(found.normalizedMinutes ?? normalizeMinutes(found.value, found.unit));
}
function isHoliday(date, holidays = []) { return holidays.includes(new Date(date).toISOString().slice(0,10)); }
function withinBusinessWindow(date, policy = {}) {
  if ((policy.businessHoursMode || 'TWENTY_FOUR_SEVEN') !== 'BUSINESS_HOURS') return true;
  const d = new Date(date);
  const day = d.getUTCDay(); if (day === 0 || day === 6) return false;
  if (isHoliday(d, policy.holidayCalendar || [])) return false;
  const hm = `${String(d.getUTCHours()).padStart(2,'0')}:${String(d.getUTCMinutes()).padStart(2,'0')}`;
  return hm >= String(policy.businessHoursStart || '09:00') && hm <= String(policy.businessHoursEnd || '18:00');
}

function getIndicator({ dueAt, completedAt = null, warningThresholdPercent = 80, startedAt = new Date() }) {
  if (!dueAt) return 'NO_SLA';
  const now = new Date();
  const due = new Date(dueAt);
  if (completedAt) return new Date(completedAt) <= due ? 'MET' : 'BREACHED';
  if (now > due) return 'BREACHED';
  const totalMs = Math.max(1, due.getTime() - new Date(startedAt).getTime());
  const remainingMs = due.getTime() - now.getTime();
  const elapsedPercent = ((totalMs - remainingMs) / totalMs) * 100;
  if (elapsedPercent >= Number(warningThresholdPercent || 80)) return 'AT_RISK';
  return 'ON_TRACK';
}

async function getEntityChain(entityId) {
  if (!entityId) return [];
  const entity = await Entity.findById(entityId).select('_id parentId type').lean();
  if (!entity) return [];
  const items = [{ id: String(entity._id), type: String(entity.type || '').toUpperCase() }];
  let cursor = entity;
  let guard = 0;
  while (cursor && cursor.parentId && guard < 20) {
    guard += 1;
    const parent = await Entity.findById(cursor.parentId).select('_id parentId type').lean();
    if (!parent) break;
    items.push({ id: String(parent._id), type: String(parent.type || '').toUpperCase() });
    cursor = parent;
  }
  return items;
}

function scorePolicy(policy) {
  let score = 0;
  if (policy.scopeLevel === 'SUBCLIENT') score += 3000;
  else if (policy.scopeLevel === 'CLIENT') score += 2000;
  else score += 1000;
  if (policy.entityId) score += 500;
  if (policy.agreementType === 'SLA') score += 40;
  if (policy.category && policy.category !== MATCH_ANY) score += 100;
  if (policy.priority && policy.priority !== MATCH_ANY) score += 50;
  if (policy.executionMode && policy.executionMode !== MATCH_ANY) score += 25;
  score -= Number(policy.rank || 100);
  return score;
}

function selectSeverityLevel(policy, severity) {
  const levels = Array.isArray(policy?.severityLevels) ? policy.severityLevels : [];
  const normalizedSeverity = String(severity || '').trim().toUpperCase();
  if (normalizedSeverity) {
    const exact = levels.find((item) => item.isEnabled !== false && String(item.severity).toUpperCase() === normalizedSeverity);
    if (exact) return exact;
  }
  const critical = levels.find((item) => item.isEnabled !== false && String(item.severity).toUpperCase() === 'CRITICAL');
  if (critical) return critical;
  return levels.find((item) => item.isEnabled !== false) || null;
}

async function resolveAgreementPolicies({ tenantId, entityId, category, priority, executionMode, supportGroupId = null, agreementType = null }) {
  const chain = await getEntityChain(entityId);
  const chainIds = chain.map((item) => item.id);
  const policies = await SlaPolicy.find({ tenantId, isActive: true, ...(agreementType ? { agreementType } : {}) }).sort({ rank: 1, createdAt: 1 }).lean();
  const normalizedCategory = String(category || '').trim().toUpperCase();
  const normalizedPriority = String(priority || '').trim().toUpperCase();
  const normalizedExecution = String(executionMode || '').trim().toUpperCase() || 'NATIVE';
  const normalizedSupportGroupId = supportGroupId ? String(supportGroupId) : null;

  return policies.filter((policy) => {
    if (policy.entityId && !chainIds.includes(String(policy.entityId))) return false;
    if (policy.scopeLevel === 'GLOBAL' && policy.entityId) return false;
    if (policy.scopeLevel === 'CLIENT') {
      const clientMatch = chain.find((item) => item.id === String(policy.entityId));
      if (!clientMatch || clientMatch.type !== 'CLIENT') return false;
    }
    if (policy.scopeLevel === 'SUBCLIENT') {
      const subMatch = chain.find((item) => item.id === String(policy.entityId));
      if (!subMatch || subMatch.type !== 'SUBCLIENT') return false;
    }
    if (policy.category && policy.category !== MATCH_ANY && String(policy.category).trim().toUpperCase() !== normalizedCategory) return false;
    if (policy.priority && policy.priority !== MATCH_ANY && String(policy.priority).trim().toUpperCase() !== normalizedPriority) return false;
    if (policy.executionMode && policy.executionMode !== MATCH_ANY && String(policy.executionMode).trim().toUpperCase() !== normalizedExecution) return false;
    if (policy.supportGroupId && normalizedSupportGroupId && String(policy.supportGroupId) !== normalizedSupportGroupId) return false;
    return true;
  }).sort((a, b) => scorePolicy(b) - scorePolicy(a));
}

async function resolveDefaultPolicyFromEntityChain({ tenantId, entityId, agreementType }) {
  const chain = await getEntityChain(entityId);
  for (const item of chain) {
    const entity = await Entity.findById(item.id).select('commitmentDefaults').lean();
    const policyId = agreementType === 'OLA' ? entity?.commitmentDefaults?.olaPolicyId : entity?.commitmentDefaults?.slaPolicyId;
    const inherit = entity?.commitmentDefaults?.inheritFromParent !== false;
    if (policyId) {
      const policy = await SlaPolicy.findOne({ _id: policyId, tenantId, isActive: true, agreementType }).lean();
      if (policy) return policy;
    }
    if (!inherit) break;
  }
  return null;
}

async function resolveSlaPolicy(context) {
  const entitySelected = await resolveDefaultPolicyFromEntityChain({ tenantId: context.tenantId, entityId: context.entityId, agreementType: 'SLA' });
  if (entitySelected) return entitySelected;
  const matching = await resolveAgreementPolicies({ ...context, agreementType: 'SLA' });
  return matching[0] || null;
}

async function resolveAgreementBundle(context) {
  const all = await resolveAgreementPolicies(context);
  const bundle = {};
  for (const type of AGREEMENT_TYPES) {
    bundle[type] = await resolveDefaultPolicyFromEntityChain({ tenantId: context.tenantId, entityId: context.entityId, agreementType: type }).catch(() => null) || all.find((item) => item.agreementType === type) || null;
  }
  return { all, bundle };
}

function buildSlaSnapshot({ policy, startedAt = new Date(), severity = null }) {
  if (!policy) {
    return {
      hasPolicy: false,
      policyId: null,
      policyName: 'No SLA',
      agreementType: 'SLA',
      scopeLevel: 'GLOBAL',
      severity: severity || '',
      responseTargetMinutes: null,
      resolutionTargetMinutes: null,
      acknowledgementTargetMinutes: null,
      workaroundTargetMinutes: null,
      updateEveryMinutes: null,
      closureConfirmationTargetMinutes: null,
      warningThresholdPercent: 80,
      responseDueAt: null,
      resolutionDueAt: null,
      firstRespondedAt: null,
      respondedByUserId: null,
      resolvedAt: null,
      responseStatus: 'NO_SLA',
      resolutionStatus: 'NO_SLA',
      breachedAt: { response: null, resolution: null },
      pausedAt: null,
      totalPausedMinutes: 0,
      stageTargets: [],
      stageStatus: [],
      escalationRecipients: [],
      allTargets: [],
      businessHoursMode: 'TWENTY_FOUR_SEVEN',
      holidayCalendar: [],
      lastEvaluatedAt: new Date()
    };
  }
  const level = selectSeverityLevel(policy, severity);
  const metricTargets = level?.metricTargets || [];
  const responseTargetMinutes = getMetricMinutes(metricTargets, 'FIRST_RESPONSE', policy.responseTargetMinutes);
  const resolutionTargetMinutes = getMetricMinutes(metricTargets, 'RESOLUTION', policy.resolutionTargetMinutes);
  const acknowledgementTargetMinutes = getMetricMinutes(metricTargets, 'ACKNOWLEDGEMENT', null);
  const workaroundTargetMinutes = getMetricMinutes(metricTargets, 'WORKAROUND', null);
  const updateEveryMinutes = getMetricMinutes(metricTargets, 'UPDATE_FREQUENCY', null);
  const closureConfirmationTargetMinutes = getMetricMinutes(metricTargets, 'CLOSURE_CONFIRMATION', null);
  const responseDueAt = responseTargetMinutes != null ? addMinutes(new Date(startedAt), responseTargetMinutes) : null;
  const resolutionDueAt = resolutionTargetMinutes != null ? addMinutes(new Date(startedAt), resolutionTargetMinutes) : null;
  return {
    hasPolicy: true,
    policyId: policy._id,
    policyName: policy.name,
    agreementType: policy.agreementType || 'SLA',
    scopeLevel: policy.scopeLevel || 'GLOBAL',
    severity: level?.severity || severity || '',
    responseTargetMinutes,
    resolutionTargetMinutes,
    acknowledgementTargetMinutes,
    workaroundTargetMinutes,
    updateEveryMinutes,
    closureConfirmationTargetMinutes,
    warningThresholdPercent: policy.warningThresholdPercent || 80,
    responseDueAt,
    resolutionDueAt,
    firstRespondedAt: null,
    respondedByUserId: null,
    resolvedAt: null,
    responseStatus: getIndicator({ dueAt: responseDueAt, warningThresholdPercent: policy.warningThresholdPercent || 80, startedAt }),
    resolutionStatus: getIndicator({ dueAt: resolutionDueAt, warningThresholdPercent: policy.warningThresholdPercent || 80, startedAt }),
    breachedAt: { response: null, resolution: null },
    pausedAt: null,
    totalPausedMinutes: 0,
    stageTargets: policy.stageTargets || [],
    stageStatus: [],
    escalationRecipients: [...new Set([...(policy.escalationRecipients || []), ...(level?.escalationRecipients || [])])],
    allTargets: metricTargets,
    businessHoursMode: policy.businessHoursMode || 'TWENTY_FOUR_SEVEN',
    holidayCalendar: policy.holidayCalendar || [],
    lastEvaluatedAt: new Date()
  };
}

function evaluateIssueSla(issue) {
  if (!issue.sla) return issue;
  const sla = issue.sla;
  if (sla.pausedAt) { sla.lastEvaluatedAt = new Date(); return issue; }
  sla.responseStatus = getIndicator({ dueAt: sla.responseDueAt, completedAt: sla.firstRespondedAt, warningThresholdPercent: sla.warningThresholdPercent, startedAt: issue.createdAt || new Date() });
  sla.resolutionStatus = getIndicator({ dueAt: sla.resolutionDueAt, completedAt: sla.resolvedAt, warningThresholdPercent: sla.warningThresholdPercent, startedAt: issue.createdAt || new Date() });
  if (sla.responseStatus === 'BREACHED' && !sla.breachedAt?.response) {
    sla.breachedAt = sla.breachedAt || {};
    sla.breachedAt.response = new Date();
  }
  if (sla.resolutionStatus === 'BREACHED' && !sla.breachedAt?.resolution) {
    sla.breachedAt = sla.breachedAt || {};
    sla.breachedAt.resolution = new Date();
  }
  sla.lastEvaluatedAt = new Date();
  return issue;
}

async function refreshAndSaveIssueSla(issue) {
  evaluateIssueSla(issue);
  await issue.save();
  return issue;
}
function pauseIssueSla(issue) { if (issue?.sla && !issue.sla.pausedAt) issue.sla.pausedAt = new Date(); return issue; }
function resumeIssueSla(issue) { if (issue?.sla?.pausedAt) { const pauseMs = Date.now() - new Date(issue.sla.pausedAt).getTime(); issue.sla.totalPausedMinutes = (issue.sla.totalPausedMinutes || 0) + Math.round(pauseMs / 60000); issue.sla.pausedAt = null; if (issue.sla.responseDueAt) issue.sla.responseDueAt = addMinutes(new Date(issue.sla.responseDueAt), Math.round(pauseMs / 60000)); if (issue.sla.resolutionDueAt) issue.sla.resolutionDueAt = addMinutes(new Date(issue.sla.resolutionDueAt), Math.round(pauseMs / 60000)); } return issue; }
function buildCommitmentSnapshots(bundle = {}, startedAt = new Date(), severity = null) {
  return Object.values(bundle).filter(Boolean).map((policy) => ({ ...buildSlaSnapshot({ policy, startedAt, severity }), commitmentType: policy.agreementType || 'SLA' }));
}
function appendSlaEvent(issue, eventType, payload = {}) {
  issue.slaEvents = issue.slaEvents || [];
  issue.slaEvents.push({ eventType, at: new Date(), ...payload });
  return issue;
}
function syncCommitmentsFromPrimarySla(issue) {
  if (!issue?.commitments) issue.commitments = [];
  const current = issue.commitments.filter((item) => item.commitmentType !== 'SLA');
  if (issue.sla?.hasPolicy) current.unshift({ ...issue.sla.toObject?.() || issue.sla, commitmentType: 'SLA' });
  issue.commitments = current;
  return issue;
}
module.exports = { resolveSlaPolicy, resolveAgreementBundle, buildSlaSnapshot, buildCommitmentSnapshots, evaluateIssueSla, refreshAndSaveIssueSla, getIndicator, addMinutes, normalizeMinutes, pauseIssueSla, resumeIssueSla, withinBusinessWindow, appendSlaEvent, syncCommitmentsFromPrimarySla };
