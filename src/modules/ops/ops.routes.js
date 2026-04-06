
const router = require('express').Router({ mergeParams: true });
const { QueueJob } = require('../queue/job.model');
const { Notification } = require('../notifications/notification.model');
const { AuditLog } = require('../audit/audit.model');
const { getMetricsSnapshot } = require('../../utils/metrics');
router.get('/', async (req, res, next) => {
  try {
    const [jobs, failedNotifications, recentAudits] = await Promise.all([
      QueueJob.find({ tenantId: req.tenant._id }).sort({ updatedAt: -1 }).limit(25),
      Notification.find({ tenantId: req.tenant._id, status: { $in: ['FAILED', 'QUEUED'] } }).sort({ updatedAt: -1 }).limit(25),
      AuditLog.find({ tenantId: req.tenant._id }).sort({ createdAt: -1 }).limit(25)
    ]);
    res.render('ops/index', { title: 'Ops Console', jobs, failedNotifications, recentAudits, metrics: getMetricsSnapshot() });
  } catch (e) { next(e); }
});
module.exports = router;
