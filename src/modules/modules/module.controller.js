const { ModuleDefinition } = require('./module.model');

async function listModules(req, res, next) {
  try {
    const items = await ModuleDefinition.find({ tenantId: req.tenant._id }).sort({ isActive: -1, name: 1 }).lean();
    if (req.originalUrl.startsWith('/api/')) return res.json({ items });
    return res.render('modules/index', { title: 'Modules', items });
  } catch (error) { return next(error); }
}

async function showNewModule(req, res, next) {
  try { return res.render('modules/new', { title: 'New Module', defaults: { code: '', name: '', description: '', ownerTeam: '', criticality: 'MEDIUM', isActive: true } }); }
  catch (error) { return next(error); }
}

async function createModule(req, res, next) {
  try {
    const body = req.body || {};
    await ModuleDefinition.create({
      tenantId: req.tenant._id,
      code: String(body.code || '').trim().toUpperCase(),
      name: String(body.name || '').trim(),
      description: String(body.description || '').trim(),
      ownerTeam: String(body.ownerTeam || '').trim(),
      criticality: String(body.criticality || 'MEDIUM').trim().toUpperCase(),
      isActive: body.isActive === 'true' || body.isActive === 'on' || body.isActive === true
    });
    req.session.success = 'Module created successfully.';
    return res.redirect(`${req.basePath}/admin/modules`);
  } catch (error) {
    if (error.code === 11000) { req.session.error = 'Module code already exists.'; return res.redirect(`${req.basePath}/admin/modules/new`); }
    return next(error);
  }
}

async function showEditModule(req, res, next) {
  try {
    const item = await ModuleDefinition.findOne({ _id: req.params.id, tenantId: req.tenant._id }).lean();
    if (!item) { req.session.error = 'Module not found.'; return res.redirect(`${req.basePath}/admin/modules`); }
    return res.render('modules/new', { title: `Edit ${item.name}`, defaults: item, item, formAction: `${req.basePath}/admin/modules/${item._id}/edit`, submitLabel: 'Save Module' });
  } catch (error) { return next(error); }
}

async function updateModule(req, res, next) {
  try {
    const body = req.body || {};
    const item = await ModuleDefinition.findOneAndUpdate({ _id: req.params.id, tenantId: req.tenant._id }, { $set: {
      code: String(body.code || '').trim().toUpperCase(),
      name: String(body.name || '').trim(),
      description: String(body.description || '').trim(),
      ownerTeam: String(body.ownerTeam || '').trim(),
      criticality: String(body.criticality || 'MEDIUM').trim().toUpperCase(),
      isActive: body.isActive === 'true' || body.isActive === 'on' || body.isActive === true
    } }, { new: true });
    if (!item) { req.session.error = 'Module not found.'; return res.redirect(`${req.basePath}/admin/modules`); }
    req.session.success = 'Module updated successfully.';
    return res.redirect(`${req.basePath}/admin/modules`);
  } catch (error) {
    if (error.code === 11000) { req.session.error = 'Module code already exists.'; return res.redirect(`${req.basePath}/admin/modules/${req.params.id}/edit`); }
    return next(error);
  }
}

async function toggleModuleStatus(req, res, next) {
  try {
    const item = await ModuleDefinition.findOneAndUpdate({ _id: req.params.id, tenantId: req.tenant._id }, { $set: { isActive: String(req.body.isActive) === 'true' } }, { new: true });
    if (!item) { req.session.error = 'Module not found.'; return res.redirect(`${req.basePath}/admin/modules`); }
    req.session.success = item.isActive ? 'Module activated.' : 'Module deactivated.';
    return res.redirect(`${req.basePath}/admin/modules`);
  } catch (error) { return next(error); }
}

module.exports = { listModules, showNewModule, createModule, showEditModule, updateModule, toggleModuleStatus };
