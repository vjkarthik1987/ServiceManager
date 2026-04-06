
const router = require('express').Router({ mergeParams: true });
const { AuditLog } = require('./audit.model');
const { User } = require('../users/user.model');

router.get('/', async (req, res, next) => {
  try {
    const filter = { tenantId: req.tenant._id };
    if (req.query.action) filter.action = req.query.action;
    if (req.query.entityType) filter.entityType = req.query.entityType;
    if (req.query.actorUserId) filter.actorUserId = req.query.actorUserId;
    if (req.query.entityId) filter.entityId = req.query.entityId;
    if (req.query.from || req.query.to) {
      filter.createdAt = {};
      if (req.query.from) filter.createdAt.$gte = new Date(req.query.from);
      if (req.query.to) { const d = new Date(req.query.to); d.setHours(23,59,59,999); filter.createdAt.$lte = d; }
    }
    const [items, actors] = await Promise.all([
      AuditLog.find(filter).populate('actorUserId', 'name email role').sort({ createdAt: -1 }).limit(200).lean(),
      User.find({ tenantId: req.tenant._id, isActive: true }).select('name email role').sort({ name: 1 }).lean()
    ]);
    res.render('audit/index', { title: 'Audit Explorer', items, actors, filters: req.query || {} });
  } catch (e) { next(e); }
});

module.exports = router;
