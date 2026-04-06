
const router = require('express').Router({ mergeParams: true });
const { requireRole } = require('../../middleware/auth');
const { getOrCreatePreference } = require('./notification-preference.service');
router.get('/', async (req, res, next) => {
  try { const pref = await getOrCreatePreference({ tenantId: req.tenant._id, userId: req.currentUser._id }); res.render('notifications/preferences', { title: 'Notification Preferences', preference: pref }); }
  catch (e) { next(e); }
});
router.post('/', async (req, res, next) => {
  try {
    const pref = await getOrCreatePreference({ tenantId: req.tenant._id, userId: req.currentUser._id });
    pref.emailEnabled = req.body.emailEnabled === 'true';
    pref.digestEnabled = req.body.digestEnabled === 'true';
    pref.digestFrequency = req.body.digestFrequency || 'DAILY';
    pref.subscribedTypes = String(req.body.subscribedTypes || '').split(',').map(v => v.trim()).filter(Boolean);
    await pref.save();
    req.session.success = 'Notification preferences updated.'; res.redirect(`${req.basePath}/admin/notification-preferences`);
  } catch (e) { next(e); }
});
module.exports = router;
