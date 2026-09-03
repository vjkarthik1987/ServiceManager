export const V23_SAAS_SERVICE_MODEL_KEY = 'SUNTEC_SAAS_V23';
export const V23_MARKER_FIELD_KEY = '__v23_service_model_key';

export function text(value) {
  return String(value ?? '').trim();
}

export function normalized(value) {
  return text(value).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
}

export function customFieldKey(field = {}) {
  return text(field.fieldKey || field.key || field.code || field.name || field.label);
}

export function customFieldValue(field = {}) {
  const value = field.value ?? field.text ?? field.selectedValue ?? field.currentValue ?? '';
  if (Array.isArray(value)) return value.map(text).join(',');
  if (value && typeof value === 'object') return text(value.code || value.name || value.label || value.id || JSON.stringify(value));
  return text(value);
}

export function getServiceModelKey(value = {}) {
  const direct = text(value.serviceModelKey || value.serviceModel?.key || value.v23ServiceModelKey);
  if (direct) return direct;
  const level1 = text(value.level1Type?.serviceModelKey || value.level1Type?.serviceModel?.key);
  if (level1) return level1;
  const level2 = text(value.level2Type?.serviceModelKey || value.level2Type?.serviceModel?.key);
  if (level2) return level2;
  const fields = Array.isArray(value.customFields) ? value.customFields : [];
  const marker = fields.find((field) => normalized(customFieldKey(field)) === normalized(V23_MARKER_FIELD_KEY)
    || normalized(customFieldKey(field)) === 'service model key');
  return marker ? customFieldValue(marker) : '';
}

export function isV23SaasRequest(value = {}) {
  return getServiceModelKey(value) === V23_SAAS_SERVICE_MODEL_KEY;
}

export function requestFamilyText(value = {}) {
  const level1 = value.level1Type || {};
  const level2 = value.level2Type || {};
  return normalized([
    value.family,
    value.requestFamily,
    level1.code,
    level1.name,
    level2.code,
    level2.name
  ].filter(Boolean).join(' '));
}

export function requestSubtypeText(value = {}) {
  const level2 = value.level2Type || {};
  return normalized(value.subtype || value.requestSubtype || level2.name || level2.code || '');
}

export function v23Family(value = {}) {
  if (!isV23SaasRequest(value)) return '';
  const family = requestFamilyText(value);
  if (/\bservice request\b|\bservice_request\b/.test(family)) return 'SERVICE_REQUEST';
  if (/\bmaintenance\b/.test(family)) return 'MAINTENANCE';
  if (/\bchange\b/.test(family)) return 'CHANGE';
  if (/\bproblem\b/.test(family)) return 'PROBLEM';
  if (/\bincident\b/.test(family)) return 'INCIDENT';
  return text(value.family).toUpperCase();
}

export function isV23SaasIncident(value = {}) {
  return isV23SaasRequest(value) && v23Family(value) === 'INCIDENT';
}

export function isV23SaasServiceRequest(value = {}) {
  return isV23SaasRequest(value) && v23Family(value) === 'SERVICE_REQUEST';
}

export function requestFamilyDisablesSla(value = {}) {
  if (!isV23SaasRequest(value)) return false;
  return isV23SaasServiceRequest(value) || v23Family(value) === 'QUERY';
}

export function automaticWorkflowTasksEnabled(value = {}) {
  return !isV23SaasIncident(value);
}

export function ensureMarkerCustomField(fields = [], extra = {}) {
  const list = Array.isArray(fields) ? fields.map((field) => ({ ...field })) : [];
  const idx = list.findIndex((field) => normalized(customFieldKey(field)) === normalized(V23_MARKER_FIELD_KEY)
    || normalized(customFieldKey(field)) === 'service model key');
  const marker = {
    fieldKey: V23_MARKER_FIELD_KEY,
    key: V23_MARKER_FIELD_KEY,
    code: V23_MARKER_FIELD_KEY,
    name: 'Service Model Key',
    label: 'Service Model Key',
    fieldType: 'hidden',
    type: 'hidden',
    value: V23_SAAS_SERVICE_MODEL_KEY,
    visibility: 'internal',
    ...extra
  };
  if (idx >= 0) list[idx] = { ...list[idx], ...marker };
  else list.push(marker);
  return list;
}

export function fieldPermission(field = {}, role = 'client', phase = 'create') {
  const p = field.permissions?.[role] || {};
  if (phase === 'create') return {
    visible: p.createVisible !== false,
    editable: p.createEditable !== false
  };
  return {
    visible: p.viewVisible !== false,
    editable: p.postCreateEditable === true
  };
}

export function clientMayChoosePriority(value = {}) {
  return !isV23SaasRequest(value);
}

export function clientMayChooseSeverityAtCreate(value = {}) {
  return isV23SaasIncident(value);
}

export function canPostCreateChangeClassification(value = {}, role = 'client', field = 'severity') {
  if (!isV23SaasRequest(value)) return true; // leave pre-v23 / normal logic alone
  if (role === 'client') return false;
  return field === 'severity' || field === 'priority';
}

export function workflowStatusByKey(workflow = {}, key = '') {
  return (workflow.statuses || []).find((status) => text(status.key) === text(key)) || null;
}

export function allowedTransitions(workflow = {}, currentStatusKey = '', context = {}) {
  const subtype = normalized(context.subtype || '');
  const role = text(context.role || '').toLowerCase();
  return (workflow.transitions || []).filter((transition) => {
    if (text(transition.from) !== text(currentStatusKey)) return false;
    if (Array.isArray(transition.roles) && transition.roles.length && !transition.roles.map((x) => text(x).toLowerCase()).includes(role)) return false;
    const subtypes = transition.condition?.subtypes;
    if (Array.isArray(subtypes) && subtypes.length && !subtypes.some((item) => normalized(item) === subtype)) return false;
    return true;
  });
}

export function nextStatusForSupportMove(workflow = {}, currentStatusKey = '') {
  if (!currentStatusKey) return workflow.startStatus || '';
  const policy = text(workflow.supportMovePolicy || 'PRESERVE').toUpperCase();
  if (policy === 'PRESERVE' || policy === 'PRESERVE_OR_MAP') return currentStatusKey;
  return workflow.startStatus || currentStatusKey;
}

export function syncStatusAcrossSupportStages(requestItem = {}, nextStatus = {}) {
  if (!isV23SaasRequest(requestItem)) return requestItem;
  const clean = JSON.parse(JSON.stringify(nextStatus || {}));
  if (Array.isArray(requestItem.activeStages)) {
    for (const stage of requestItem.activeStages) stage.currentStatus = JSON.parse(JSON.stringify(clean));
  }
  requestItem.currentStatus = JSON.parse(JSON.stringify(clean));
  return requestItem;
}

export function recalculateSlaPreservingStart(previousSla = {}, recalculatedSla = {}) {
  const result = { ...recalculatedSla };
  const previousStart = previousSla.startedAt || previousSla.startAt || previousSla.started_at;
  if (previousStart) result.startedAt = previousStart;
  return result;
}

export function buildHistorySummary(request = {}) {
  const timeline = Array.isArray(request.timeline) ? request.timeline : [];
  const last = (types) => [...timeline].reverse().find((event) => types.includes(text(event.eventType))) || null;
  return {
    createdBy: request.requester || request.createdBy || {},
    createdAt: request.createdAt || null,
    requester: request.raisedOnBehalfOf?.email || request.requester?.email || request.requester || null,
    currentSupportLevel: request.currentSupportLevel || null,
    assignedTo: (request.activeStages || []).find((stage) => stage.isPrimary)?.assignedTo || null,
    lastStatusChange: last(['status_changed','client_information_submitted','client_resolution_rejected','client_resolution_accepted']),
    lastPublicUpdate: [...(request.comments || [])].reverse().find((comment) => text(comment.visibility) === 'client_visible') || null,
    lastSupportMovement: last(['support_level_changed','parallel_support_started']),
    lastSeverityChange: last(['severity_changed']),
    lastPriorityChange: last(['priority_changed'])
  };
}

export function assertNormalIncidentUntouched(before = {}, after = {}) {
  if (isV23SaasRequest(before) || isV23SaasRequest(after)) return true;
  const keys = ['workflowDefinition','activeStages','currentStatus','currentSupportLevel','severity','priority','sla','tasks'];
  for (const key of keys) {
    const a = JSON.stringify(before[key] ?? null);
    const b = JSON.stringify(after[key] ?? null);
    if (a !== b) throw new Error(`Normal incident guard failed: ${key} changed without ${V23_SAAS_SERVICE_MODEL_KEY}.`);
  }
  return true;
}

export function normalizeFormName(value) {
  return normalized(value).replace(/\bcreate modify delete\b/g, '').trim();
}

export function matchForm(forms = [], value = {}) {
  if (!isV23SaasRequest(value)) return null;
  const subtype = normalizeFormName(requestSubtypeText(value));
  return forms.find((form) => {
    const names = [form.subtype, ...(form.aliases || [])].map(normalizeFormName);
    return names.includes(subtype);
  }) || null;
}
