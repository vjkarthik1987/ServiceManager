
const router = require('express').Router({ mergeParams: true });
const { QueueJob } = require('../queue/job.model');
const { Notification } = require('../notifications/notification.model');
const { AuditLog } = require('../audit/audit.model');
const { Issue } = require('../issues/issue.model');
const { getMetricsSnapshot } = require('../../utils/metrics');
router.get('/', async (req, res, next) => {
  try {
    const [jobs, failedNotifications, recentAudits, recentIssues] = await Promise.all([
      QueueJob.find({ tenantId: req.tenant._id }).sort({ updatedAt: -1 }).limit(25),
      Notification.find({ tenantId: req.tenant._id, status: { $in: ['FAILED', 'QUEUED'] } }).sort({ updatedAt: -1 }).limit(25),
      AuditLog.find({ tenantId: req.tenant._id }).sort({ createdAt: -1 }).limit(25),
      Issue.find({ tenantId: req.tenant._id }).sort({ updatedAt: -1 }).limit(12).populate('entityId', 'name path').lean()
    ]);
    res.render('ops/index', { title: 'Ops Console', jobs, failedNotifications, recentAudits, recentIssues, metrics: getMetricsSnapshot() });
  } catch (e) { next(e); }
});
module.exports = router;
