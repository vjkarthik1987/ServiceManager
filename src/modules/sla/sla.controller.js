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
    return res.render('sla-policies/new', {
      title: 'New Service Commitment Policy',
      entities,
      priorityOptions: PRIORITY_OPTIONS,
      executionOptions: EXECUTION_OPTIONS,
      agreementTypes: AGREEMENT_TYPES,
      scopeLevels: SCOPE_LEVELS,
      scopeBehaviors: SCOPE_BEHAVIORS,
      timeUnits: TIME_UNITS,
      metricTypes: METRIC_TYPES,
      severityLevels: ['BLOCKER', 'CRITICAL', 'HIGH', 'MEDIUM', 'LOW'],
      defaults: { category: 'ANY', priority: 'ANY', executionMode: 'ANY', warningThresholdPercent: 80, responseTargetMinutes: 60, resolutionTargetMinutes: 480, rank: 100, isActive: true, agreementType: 'SLA', scopeLevel: 'GLOBAL', scopeBehavior: 'DIRECT', inheritsFromParent: true }
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
    const severityLevels = ['BLOCKER', 'CRITICAL', 'HIGH', 'MEDIUM', 'LOW'].map((severity) => ({
      severity,
      displayName: severity,
      isEnabled: true,
      metricTargets: parseMetricTargets(body, severity),
      escalationRecipients: String(body[`${severity}_escalationRecipients`] || '').split(',').map((item) => item.trim()).filter(Boolean),
      escalationNote: String(body[`${severity}_escalationNote`] || '').trim()
    })).filter((item) => item.metricTargets.length);

    const item = await SlaPolicy.create({
      tenantId: req.tenant._id,
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
    const severityLevels = ['BLOCKER', 'CRITICAL', 'HIGH', 'MEDIUM', 'LOW'].map((severity) => ({
      severity,
      displayName: severity,
      isEnabled: true,
      metricTargets: parseMetricTargets(body, severity),
      escalationRecipients: String(body[`${severity}_escalationRecipients`] || '').split(',').map((item) => item.trim()).filter(Boolean),
      escalationNote: String(body[`${severity}_escalationNote`] || '').trim()
    })).filter((item) => item.metricTargets.length);

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
