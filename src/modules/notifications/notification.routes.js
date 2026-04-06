
const router = require('express').Router({ mergeParams: true });
const { Notification } = require('./notification.model');
const { getOrCreatePreference } = require('./notification-preference.service');
const { markNotificationRead } = require('./notification.service');

router.get('/', async (req, res, next) => {
  try {
    const filter = { tenantId: req.tenant._id, recipientUserId: req.currentUser._id, channel: 'IN_APP' };
    if (req.query.state === 'unread') filter.readAt = null;
    const notifications = await Notification.find(filter).sort({ createdAt: -1 }).limit(100).lean();
    const preference = await getOrCreatePreference({ tenantId: req.tenant._id, userId: req.currentUser._id });
    res.render('notifications/index', { title: 'Notifications', notifications, preference, state: req.query.state || 'all' });
  } catch (e) { next(e); }
});

router.post('/mark-all-read', async (req, res, next) => {
  try {
    await markNotificationRead({ tenantId: req.tenant._id, userId: req.currentUser._id, markAll: true });
    req.session.success = 'All notifications marked as read.';
    res.redirect(`${req.basePath}/admin/notifications`);
  } catch (e) { next(e); }
});

router.post('/:id/read', async (req, res, next) => {
  try {
    await markNotificationRead({ tenantId: req.tenant._id, userId: req.currentUser._id, notificationId: req.params.id });
    const target = req.body.redirectTo || `${req.basePath}/admin/notifications`;
    res.redirect(target);
  } catch (e) { next(e); }
});

module.exports = router;
