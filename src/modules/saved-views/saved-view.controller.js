
const { SavedView } = require('./saved-view.model');

function normalizeFilters(body = {}) {
  return {
    q: body.q || '',
    entityId: body.entityId || '',
    status: body.status || '',
    priority: body.priority || '',
    triageStatus: body.triageStatus || '',
    assignedToUserId: body.assignedToUserId || '',
    createdByUserId: body.createdByUserId || '',
    executionMode: body.executionMode || '',
    routingStatus: body.routingStatus || '',
    supportGroupId: body.supportGroupId || '',
    slaStatus: body.slaStatus || '',
    queue: body.queue || ''
  };
}

async function listSavedViews(req, res, next) {
  try {
    const views = await SavedView.find({ tenantId: req.tenant._id, userId: req.currentUser._id }).sort({ isDefault: -1, name: 1 }).lean();
    if (req.originalUrl.startsWith('/api/')) return res.json({ items: views });
    return res.render('saved-views/index', { title: 'Saved Views', views });
  } catch (e) { next(e); }
}

async function createSavedView(req, res, next) {
  try {
    const name = String(req.body.name || '').trim();
    if (!name) return res.status(400).json({ error: 'View name is required.' });
    const filters = normalizeFilters(req.body);
    const isDefault = req.body.isDefault === true || req.body.isDefault === 'true' || req.body.isDefault === 'on';
    if (isDefault) await SavedView.updateMany({ tenantId: req.tenant._id, userId: req.currentUser._id }, { $set: { isDefault: false } });
    const item = await SavedView.findOneAndUpdate(
      { tenantId: req.tenant._id, userId: req.currentUser._id, name },
      { $set: { name, filters, isDefault } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    if (req.originalUrl.startsWith('/api/')) return res.status(201).json({ item });
    req.session.success = 'Saved view stored.';
    return res.redirect(`${req.basePath}/admin/saved-views`);
  } catch (e) { next(e); }
}

async function updateSavedView(req, res, next) {
  try {
    const view = await SavedView.findOne({ _id: req.params.id, tenantId: req.tenant._id, userId: req.currentUser._id });
    if (!view) return res.status(404).json({ error: 'Saved view not found.' });
    const name = String(req.body.name || view.name || '').trim();
    const filters = req.body.filters ? req.body.filters : normalizeFilters(req.body);
    const isDefault = req.body.isDefault === true || req.body.isDefault === 'true' || req.body.isDefault === 'on';
    if (isDefault) await SavedView.updateMany({ tenantId: req.tenant._id, userId: req.currentUser._id, _id: { $ne: view._id } }, { $set: { isDefault: false } });
    view.name = name;
    view.filters = filters;
    view.isDefault = !!isDefault;
    await view.save();
    return res.json({ item: view });
  } catch (e) { next(e); }
}

async function deleteSavedView(req, res, next) {
  try {
    const deleted = await SavedView.findOneAndDelete({ _id: req.params.id, tenantId: req.tenant._id, userId: req.currentUser._id });
    if (!deleted) return res.status(404).json({ error: 'Saved view not found.' });
    return res.json({ ok: true });
  } catch (e) { next(e); }
}

module.exports = { listSavedViews, createSavedView, updateSavedView, deleteSavedView, normalizeFilters };
