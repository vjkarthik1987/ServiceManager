const mongoose = require('mongoose');
const { SlaPolicy, PRIORITY_OPTIONS, EXECUTION_OPTIONS, AGREEMENT_TYPES, SCOPE_LEVELS, SCOPE_BEHAVIORS, TIME_UNITS, METRIC_TYPES } = require('./sla-policy.model');
const { Entity } = require('../entities/entity.model');
const { resolveSlaPolicy, resolveAgreementBundle, normalizeMinutes } = require('./sla.service');

function badRequest(message) {
  const err = new Error(message);
  err.status = 400;
  return err;
}

function parseMetricTargets(body, severityKey) {
  const metrics = [];
  for (const metricType of METRIC_TYPES) {
    const valueKey = `${severityKey}_${metricType}_value`;
    const unitKey = `${severityKey}_${metricType}_unit`;
    const rawValue = body[valueKey];
    if (rawValue === undefined || rawValue === null || String(rawValue).trim() === '') continue;
    const value = Number(rawValue);
    if (!Number.isFinite(value) || value < 0) throw badRequest(`Invalid ${metricType} value for ${severityKey}.`);
    const unit = String(body[unitKey] || 'MINUTES').trim().toUpperCase();
    metrics.push({ metricType, value, unit, normalizedMinutes: normalizeMinutes(value, unit) });
  }
  return metrics;
}

const SIMPLE_SUPPORT_PRESETS = {

  AXIS_SAMPLE: {
    label: 'AXIS Custom – Response / workaround / permanent fix',
    agreementType: 'SLA',
    businessHoursMode: 'BUSINESS_HOURS',
    warningThresholdPercent: 80,
    defaultStatusUpdate: 'Track response, incident workaround and problem/permanent fix separately.',
    severities: {
      CRITICAL: { displayName: 'S1', firstResponse: { value: 4, unit: 'HOURS' }, workaround: { value: 24, unit: 'HOURS' }, permanentFix: { value: 5, unit: 'DAYS' } },
      HIGH: { displayName: 'S2', firstResponse: { value: 24, unit: 'HOURS' }, workaround: { value: 4, unit: 'DAYS' }, permanentFix: { value: 10, unit: 'DAYS' } },
      MEDIUM: { displayName: 'S3', firstResponse: { value: 5, unit: 'DAYS' }, workaround: null, permanentFix: { value: 20, unit: 'DAYS' } },
      LOW: { displayName: 'S4', firstResponse: { value: 7, unit: 'DAYS' }, workaround: null, permanentFix: { value: 40, unit: 'DAYS' } }
    }
  },  SILVER: {
    label: 'Silver – Standard SLA',
    agreementType: 'SLA',
    businessHoursMode: 'BUSINESS_HOURS',
    warningThresholdPercent: 80,
    defaultStatusUpdate: 'Daily for S1/S2. Periodic project updates for S3/S4.',
    severities: {
      CRITICAL: { displayName: 'S1 Critical', firstResponse: { value: 2, unit: 'HOURS' }, resolution: { value: 48, unit: 'HOURS' } },
      HIGH: { displayName: 'S2 Serious', firstResponse: { value: 4, unit: 'HOURS' }, resolution: { value: 96, unit: 'HOURS' } },
      MEDIUM: { displayName: 'S3 Moderate', firstResponse: { value: 3, unit: 'DAYS' }, resolution: { value: 12, unit: 'DAYS' } },
      LOW: { displayName: 'S4 Minor', firstResponse: { value: 10, unit: 'DAYS' }, resolution: null }
    }
  },
  GOLD: {
    label: 'Gold – Expedited SLA',
    agreementType: 'SLA',
    businessHoursMode: 'BUSINESS_HOURS',
    warningThresholdPercent: 80,
    defaultStatusUpdate: 'Every 4 hours for S1 if required. Daily for S2. Periodic project updates for S3/S4.',
    severities: {
      CRITICAL: { displayName: 'S1 Critical', firstResponse: { value: 1, unit: 'HOURS' }, resolution: { value: 24, unit: 'HOURS' } },
      HIGH: { displayName: 'S2 Serious', firstResponse: { value: 2, unit: 'HOURS' }, resolution: { value: 72, unit: 'HOURS' } },
      MEDIUM: { displayName: 'S3 Moderate', firstResponse: { value: 2, unit: 'DAYS' }, resolution: { value: 10, unit: 'DAYS' } },
      LOW: { displayName: 'S4 Minor', firstResponse: { value: 8, unit: 'DAYS' }, resolution: null }
    }
  },
  PLATINUM: {
    label: 'Platinum – Expedited SLA',
    agreementType: 'SLA',
    businessHoursMode: 'TWENTY_FOUR_SEVEN',
    warningThresholdPercent: 75,
    defaultStatusUpdate: 'Every 2 hours for S1 if required. Twice a day for S2. Periodic project updates for S3/S4.',
    severities: {
      CRITICAL: { displayName: 'S1 Critical', firstResponse: { value: 0.5, unit: 'HOURS' }, resolution: { value: 12, unit: 'HOURS' } },
      HIGH: { displayName: 'S2 Serious', firstResponse: { value: 1, unit: 'HOURS' }, resolution: { value: 48, unit: 'HOURS' } },
      MEDIUM: { displayName: 'S3 Moderate', firstResponse: { value: 1, unit: 'DAYS' }, resolution: { value: 8, unit: 'DAYS' } },
      LOW: { displayName: 'S4 Minor', firstResponse: { value: 6, unit: 'DAYS' }, resolution: null }
    }
  },
  OLA_STANDARD: {
    label: 'OLA – Internal handoff default',
    agreementType: 'OLA',
    businessHoursMode: 'BUSINESS_HOURS',
    warningThresholdPercent: 80,
    defaultStatusUpdate: 'Use for internal acknowledgements and handoffs.',
    severities: {
      CRITICAL: { displayName: 'Critical', acknowledgement: { value: 30, unit: 'MINUTES' }, resolution: { value: 8, unit: 'HOURS' } },
      HIGH: { displayName: 'High', acknowledgement: { value: 1, unit: 'HOURS' }, resolution: { value: 16, unit: 'HOURS' } },
      MEDIUM: { displayName: 'Medium', acknowledgement: { value: 2, unit: 'HOURS' }, resolution: { value: 2, unit: 'DAYS' } },
      LOW: { displayName: 'Low', acknowledgement: { value: 4, unit: 'HOURS' }, resolution: { value: 4, unit: 'DAYS' } }
    }
  }
};

function buildSeverityDefaults(defaults, severity) {
  const data = (defaults.severityDefaults && defaults.severityDefaults[severity]) || {};
  return {
    displayName: data.displayName || severity,
    FIRST_RESPONSE: data.FIRST_RESPONSE || null,
    ACKNOWLEDGEMENT: data.ACKNOWLEDGEMENT || null,
    RESOLUTION: data.RESOLUTION || null,
    WORKAROUND: data.WORKAROUND || null,
    PERMANENT_FIX: data.PERMANENT_FIX || null,
    statusUpdate: data.statusUpdate || '',
    escalationNote: data.escalationNote || ''
  };
}

function buildConfiguredSeverityOptions(tenant) {
  const configured = Array.isArray(tenant?.issueConfig?.priorities) ? tenant.issueConfig.priorities : [];
  const fallback = PRIORITY_OPTIONS.filter((item) => item !== 'ANY');
  const source = configured.length ? configured : fallback;
  const seen = new Set();
  const options = [];

  source.forEach((item) => {
    const rawLabel = String(item || '').trim();
    if (!rawLabel) return;
    const value = rawLabel.toUpperCase();
    if (seen.has(value)) return;
    seen.add(value);
    options.push({ value, label: rawLabel });
  });

  return options;
}

function getSeverityTemplateEntries(preset = {}) {
  return Object.values(preset?.severities || {});
}

function buildTemplateDefaultsForSeverities(severityOptions = [], presetKey = 'SILVER') {
  const preset = SIMPLE_SUPPORT_PRESETS[presetKey] || SIMPLE_SUPPORT_PRESETS.SILVER;
  const templateRows = getSeverityTemplateEntries(preset);
  const defaults = {};

  severityOptions.forEach((option, index) => {
    const template = templateRows[index] || templateRows[templateRows.length - 1] || {};
    defaults[option.value] = {
      displayName: option.label,
      FIRST_RESPONSE: template.firstResponse ? { ...template.firstResponse } : null,
      ACKNOWLEDGEMENT: template.acknowledgement ? { ...template.acknowledgement } : null,
      RESOLUTION: template.resolution ? { ...template.resolution } : null,
      WORKAROUND: template.workaround ? { ...template.workaround } : null,
      PERMANENT_FIX: template.permanentFix ? { ...template.permanentFix } : null,
      statusUpdate: preset.defaultStatusUpdate || '',
      escalationNote: ''
    };
  });

  return defaults;
}

function buildSeverityLevelsFromBody(body = {}, severityOptions = []) {
  return (severityOptions || []).map((option) => ({
    severity: option.value,
    displayName: String(body[`${option.value}_displayName`] || option.label || option.value).trim() || option.label || option.value,
    isEnabled: true,
    metricTargets: parseMetricTargets(body, option.value),
    escalationRecipients: String(body[`${option.value}_escalationRecipients`] || '').split(',').map((item) => item.trim()).filter(Boolean),
    escalationNote: String(body[`${option.value}_escalationNote`] || '').trim()
  })).filter((item) => item.metricTargets.length);
}


async function listSlaPoliciesPage(req, res, next) {
  try {
    const items = await SlaPolicy.find({ tenantId: req.tenant._id }).populate('entityId').sort({ isActive: -1, agreementType: 1, rank: 1, createdAt: 1 }).lean();
    return res.render('sla-policies/index', { title: 'Service Commitments', items });
  } catch (error) {
    return next(error);
  }
}

async function showNewSlaPolicyPage(req, res, next) {
  try {
    const entities = await Entity.find({ tenantId: req.tenant._id, isActive: true }).sort({ path: 1 }).lean();
    const severityOptions = buildConfiguredSeverityOptions(req.tenant);
    const defaults = {
      category: 'ANY',
      priority: 'ANY',
      executionMode: 'ANY',
      warningThresholdPercent: 80,
      responseTargetMinutes: 60,
      resolutionTargetMinutes: 480,
      rank: 100,
      isActive: true,
      agreementType: 'SLA',
      scopeLevel: 'GLOBAL',
      scopeBehavior: 'DIRECT',
      inheritsFromParent: true,
      businessHoursMode: 'BUSINESS_HOURS',
      businessHoursStart: '09:00',
      businessHoursEnd: '18:00',
      simpleTemplate: 'SILVER',
      simpleStatusUpdate: SIMPLE_SUPPORT_PRESETS.SILVER.defaultStatusUpdate,
      severityDefaults: buildTemplateDefaultsForSeverities(severityOptions, 'SILVER')
    };
    return res.render('sla-policies/new', {
      title: 'New Service Commitment Policy',
      entities,
      priorityOptions: [PRIORITY_OPTIONS[0], ...severityOptions.map((item) => item.value)],
      executionOptions: EXECUTION_OPTIONS,
      agreementTypes: AGREEMENT_TYPES,
      scopeLevels: SCOPE_LEVELS,
      scopeBehaviors: SCOPE_BEHAVIORS,
      timeUnits: TIME_UNITS,
      metricTypes: METRIC_TYPES,
      severityLevels: severityOptions,
      defaults,
      simpleSupportPresets: SIMPLE_SUPPORT_PRESETS,
      buildSeverityDefaults
    });
  } catch (error) {
    return next(error);
  }
}

async function createSlaPolicy(req, res, next) {
  try {
    const body = req.body || {};
    const entityId = body.entityId && String(body.entityId).trim() ? String(body.entityId).trim() : null;
    if (entityId && !mongoose.Types.ObjectId.isValid(entityId)) throw badRequest('Valid entityId is required.');
    const severityOptions = buildConfiguredSeverityOptions(req.tenant);
    const severityLevels = buildSeverityLevelsFromBody(body, severityOptions);

    const item = await SlaPolicy.create({
      tenantId: req.tenant._id,
      name: String(body.name || '').trim(),
      description: String(body.description || '').trim(),
      supportPackage: String(body.supportPackage || '').trim() || 'Standard',
      agreementType: String(body.agreementType || 'SLA').trim().toUpperCase(),
      scopeLevel: String(body.scopeLevel || 'GLOBAL').trim().toUpperCase(),
      scopeBehavior: String(body.scopeBehavior || 'DIRECT').trim().toUpperCase(),
      entityId: entityId || null,
      inheritsFromParent: !(body.inheritsFromParent === 'false'),
      category: String(body.category || 'ANY').trim().toUpperCase() || 'ANY',
      priority: String(body.priority || 'ANY').trim().toUpperCase() || 'ANY',
      executionMode: String(body.executionMode || 'ANY').trim().toUpperCase() || 'ANY',
      responseTargetMinutes: Number(body.responseTargetMinutes || 0),
      resolutionTargetMinutes: Number(body.resolutionTargetMinutes || 0),
      warningThresholdPercent: Number(body.warningThresholdPercent || 80),
      rank: Number(body.rank || 100),
      isActive: body.isActive === 'true' || body.isActive === 'on' || body.isActive === true,
      businessHoursMode: String(body.businessHoursMode || 'TWENTY_FOUR_SEVEN').trim().toUpperCase(),
      businessHoursStart: String(body.businessHoursStart || '09:00').trim(),
      businessHoursEnd: String(body.businessHoursEnd || '18:00').trim(),
      escalationRecipients: String(body.escalationRecipients || '').split(',').map((item) => item.trim()).filter(Boolean),
      escalationNote: String(body.escalationNote || '').trim(),
      severityLevels
    });
    if (!req.originalUrl.startsWith('/api/')) {
      req.session.success = 'Service commitment policy created successfully.';
      return res.redirect(`${req.basePath}/admin/sla-policies`);
    }
    return res.status(201).json({ item });
  } catch (error) {
    if (!req.originalUrl.startsWith('/api/') && error.code === 11000) {
      req.session.error = 'Policy name already exists.';
      return res.redirect(`${req.basePath}/admin/sla-policies/new`);
    }
    return next(error);
  }
}

async function listSlaPoliciesApi(req, res, next) {
  try {
    const items = await SlaPolicy.find({ tenantId: req.tenant._id }).sort({ isActive: -1, rank: 1, createdAt: 1 }).lean();
    return res.json({ items });
  } catch (error) {
    return next(error);
  }
}

async function resolveSlaPreviewApi(req, res, next) {
  try {
    const item = await resolveSlaPolicy({
      tenantId: req.tenant._id,
      entityId: req.query.entityId,
      category: req.query.category,
      priority: req.query.priority,
      executionMode: req.query.executionMode,
      supportGroupId: req.query.supportGroupId
    });
    const agreements = await resolveAgreementBundle({
      tenantId: req.tenant._id,
      entityId: req.query.entityId,
      category: req.query.category,
      priority: req.query.priority,
      executionMode: req.query.executionMode,
      supportGroupId: req.query.supportGroupId
    });
    return res.json({ item, agreements });
  } catch (error) {
    return next(error);
  }
}



async function updateSlaPolicy(req, res, next) {
  try {
    const body = req.body || {};
    const entityId = body.entityId && String(body.entityId).trim() ? String(body.entityId).trim() : null;
    const severityOptions = buildConfiguredSeverityOptions(req.tenant);
    const severityLevels = buildSeverityLevelsFromBody(body, severityOptions);

    const item = await SlaPolicy.findOneAndUpdate(
      { _id: req.params.id, tenantId: req.tenant._id },
      { $set: {
        name: String(body.name || '').trim(),
        description: String(body.description || '').trim(),
        agreementType: String(body.agreementType || 'SLA').trim().toUpperCase(),
        scopeLevel: String(body.scopeLevel || 'GLOBAL').trim().toUpperCase(),
        scopeBehavior: String(body.scopeBehavior || 'DIRECT').trim().toUpperCase(),
        entityId: entityId || null,
        inheritsFromParent: !(body.inheritsFromParent === 'false'),
        category: String(body.category || 'ANY').trim().toUpperCase() || 'ANY',
        priority: String(body.priority || 'ANY').trim().toUpperCase() || 'ANY',
        executionMode: String(body.executionMode || 'ANY').trim().toUpperCase() || 'ANY',
        responseTargetMinutes: Number(body.responseTargetMinutes || 0),
        resolutionTargetMinutes: Number(body.resolutionTargetMinutes || 0),
        warningThresholdPercent: Number(body.warningThresholdPercent || 80),
        rank: Number(body.rank || 100),
        isActive: body.isActive === 'true' || body.isActive === 'on' || body.isActive === true,
        businessHoursMode: String(body.businessHoursMode || 'TWENTY_FOUR_SEVEN').trim().toUpperCase(),
        businessHoursStart: String(body.businessHoursStart || '09:00').trim(),
        businessHoursEnd: String(body.businessHoursEnd || '18:00').trim(),
        escalationRecipients: String(body.escalationRecipients || '').split(',').map((item) => item.trim()).filter(Boolean),
        escalationNote: String(body.escalationNote || '').trim(),
        severityLevels
      } },
      { new: true }
    );
    if (!item) return res.status(404).json({ error: 'Policy not found' });
    return res.json({ item });
  } catch (error) { return next(error); }
}

module.exports = { listSlaPoliciesPage, showNewSlaPolicyPage, createSlaPolicy, listSlaPoliciesApi, resolveSlaPreviewApi, updateSlaPolicy };
