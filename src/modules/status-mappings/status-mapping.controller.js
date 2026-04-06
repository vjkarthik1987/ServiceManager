const { StatusMapping } = require('./status-mapping.model');
const { logAudit } = require('../audit/audit.service');

async function listStatusMappingsPage(req, res, next) {
  try {
    const items = await StatusMapping.find({ tenantId: req.tenant._id }).sort({ jiraProjectKey: 1, rank: 1, internalStatus: 1 }).lean();
    res.render('status-mappings/index', { title: 'Status Mappings', items });
  } catch (error) {
    next(error);
  }
}

async function listStatusMappingsApi(req, res, next) {
  try {
    const items = await StatusMapping.find({ tenantId: req.tenant._id }).sort({ jiraProjectKey: 1, rank: 1, internalStatus: 1 }).lean();
    res.json({ items });
  } catch (error) {
    next(error);
  }
}

function parseBody(body = {}) {
  return {
    jiraProjectKey: String(body.jiraProjectKey || 'DEFAULT').trim().toUpperCase() || 'DEFAULT',
    internalStatus: String(body.internalStatus || '').trim().toUpperCase(),
    customerLabel: String(body.customerLabel || '').trim(),
    badgeTone: String(body.badgeTone || 'subtle').trim(),
    isActive: body.isActive === true || body.isActive === 'true' || body.isActive === 'on',
    rank: Number(body.rank || 100) || 100
  };
}

async function createStatusMapping(req, res, next) {
  try {
    const payload = parseBody(req.body);
    if (!payload.internalStatus || !payload.customerLabel) {
      const message = 'internalStatus and customerLabel are required.';
      if (req.originalUrl.startsWith('/api/')) return res.status(400).json({ error: message });
      req.session.error = message;
      return res.redirect(`${req.basePath}/admin/status-mappings`);
    }
    const item = await StatusMapping.create({ tenantId: req.tenant._id, ...payload });
    await logAudit({ tenantId: req.tenant._id, actorUserId: req.currentUser._id, action: 'status_mapping.created', entityType: 'status_mapping', entityId: item._id, after: payload });
    if (req.originalUrl.startsWith('/api/')) return res.status(201).json({ item });
    req.session.success = 'Status mapping created.';
    res.redirect(`${req.basePath}/admin/status-mappings`);
  } catch (error) {
    if (error.code === 11000) {
      if (req.originalUrl.startsWith('/api/')) return res.status(409).json({ error: 'Mapping already exists for this status and project.' });
      req.session.error = 'Mapping already exists for this status and project.';
      return res.redirect(`${req.basePath}/admin/status-mappings`);
    }
    next(error);
  }
}

async function updateStatusMapping(req, res, next) {
  try {
    const payload = parseBody(req.body);
    const item = await StatusMapping.findOneAndUpdate({ _id: req.params.id, tenantId: req.tenant._id }, { $set: payload }, { new: true });
    if (!item) return res.status(404).json({ error: 'Mapping not found.' });
    await logAudit({ tenantId: req.tenant._id, actorUserId: req.currentUser._id, action: 'status_mapping.updated', entityType: 'status_mapping', entityId: item._id, after: payload });
    res.json({ item });
  } catch (error) {
    next(error);
  }
}

module.exports = { listStatusMappingsPage, listStatusMappingsApi, createStatusMapping, updateStatusMapping };
