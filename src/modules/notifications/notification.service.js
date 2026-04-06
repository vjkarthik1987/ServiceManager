const nodemailer = require('nodemailer');
const { Notification } = require('./notification.model');
const { User } = require('../users/user.model');
const { canSendNotification } = require('./notification-preference.service');
const templates = {
  SLA_RESPONSE_BREACHED: (ctx) => ({ subject: `Response SLA breached · ${ctx.issueNumber || 'Issue'}`, body: `Response SLA breached for ${ctx.issueNumber || 'issue'}.` }),
  SLA_RESOLUTION_BREACHED: (ctx) => ({ subject: `Resolution SLA breached · ${ctx.issueNumber || 'Issue'}`, body: `Resolution SLA breached for ${ctx.issueNumber || 'issue'}.` }),
  JIRA_PUSH_SUCCESS: (ctx) => ({ subject: `Jira sync complete · ${ctx.issueNumber || 'Issue'}`, body: `Jira push succeeded for ${ctx.issueNumber || 'issue'}.` })
};

let transport = null;
function getMailTransport() {
  if (transport) return transport;
  const host = process.env.SMTP_HOST;
  if (!host) return null;
  transport = nodemailer.createTransport({
    host,
    port: Number(process.env.SMTP_PORT || 587),
    secure: String(process.env.SMTP_SECURE || 'false') === 'true',
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS || '' } : undefined
  });
  return transport;
}

async function createNotification({ tenantId, issueId = null, type, recipientUserId = null, recipientEmail = '', subject = '', body = '', metadata = null, sendEmail = true, templateKey = '' }) {
  let resolvedEmail = String(recipientEmail || '').trim();
  if (!resolvedEmail && recipientUserId) {
    const user = await User.findById(recipientUserId).select('email').lean();
    resolvedEmail = user?.email || '';
  }

  const template = templates[templateKey || type] ? templates[templateKey || type](metadata || {}) : null;
  if (!subject && template?.subject) subject = template.subject;
  if (!body && template?.body) body = template.body;
  const allowed = await canSendNotification({ tenantId, userId: recipientUserId, type, channel: 'EMAIL' });
  const notification = await Notification.create({
    tenantId,
    issueId,
    type,
    recipientUserId,
    recipientEmail: resolvedEmail,
    subject,
    body,
    metadata,
    templateKey: templateKey || type,
    channel: resolvedEmail && sendEmail ? 'EMAIL' : 'IN_APP',
    status: (!allowed && resolvedEmail) ? 'SUPPRESSED' : (resolvedEmail && sendEmail ? 'QUEUED' : 'SENT'),
    sentAt: resolvedEmail && sendEmail ? null : new Date(),
    nextAttemptAt: resolvedEmail && sendEmail ? new Date() : null
  });

  if (!resolvedEmail || !sendEmail || !allowed) return notification;
  const { enqueueJob } = require('../queue/queue.service');
  await enqueueJob({ tenantId, type: 'NOTIFICATION_DELIVERY', payload: { notificationId: notification._id }, maxAttempts: 5 });
  return notification;
}

async function deliverNotification(notification) {
  if (!notification || notification.status === 'SENT' || notification.status === 'SUPPRESSED') return notification;
  const mailer = getMailTransport();
  if (!mailer) {
    notification.status = 'FAILED';
    notification.failureReason = 'SMTP not configured';
    notification.retryCount = (notification.retryCount || 0) + 1;
    notification.nextAttemptAt = new Date(Date.now() + Math.min(notification.retryCount, 5) * 10 * 60 * 1000);
    await notification.save();
    return notification;
  }
  try {
    await mailer.sendMail({ from: process.env.SMTP_FROM || process.env.SMTP_USER || 'esop@localhost', to: notification.recipientEmail, subject: notification.subject, text: notification.body });
    notification.status = 'SENT';
    notification.sentAt = new Date();
    notification.failureReason = '';
  } catch (error) {
    notification.status = 'FAILED';
    notification.failureReason = error.message;
    notification.retryCount = (notification.retryCount || 0) + 1;
    notification.nextAttemptAt = new Date(Date.now() + Math.min(notification.retryCount, 5) * 10 * 60 * 1000);
  }
  await notification.save();
  return notification;
}

async function buildDigestNotifications() {
  const pending = await Notification.find({ status: { $in: ['QUEUED', 'FAILED'] }, channel: 'EMAIL', nextAttemptAt: { $lte: new Date() } }).limit(50);
  return pending;
}

async function notifyUsers({ tenantId, issueId = null, type, userIds = [], subject = '', body = '', metadata = null, sendEmail = true, actorUserId = null }) {
  const ids = Array.from(new Set((userIds || []).filter(Boolean).map(String))).filter((id) => !actorUserId || String(actorUserId) !== String(id));
  const created = [];
  for (const userId of ids) {
    created.push(await createNotification({ tenantId, issueId, type, recipientUserId: userId, subject, body, metadata, sendEmail }));
    await Notification.create({
      tenantId, issueId, type, recipientUserId: userId, subject, body, metadata, templateKey: type,
      channel: 'IN_APP', status: 'SENT', sentAt: new Date()
    });
  }
  return created;
}

async function getUnreadCount({ tenantId, userId }) {
  return Notification.countDocuments({ tenantId, recipientUserId: userId, channel: 'IN_APP', readAt: null });
}

async function markNotificationRead({ tenantId, userId, notificationId = null, markAll = false }) {
  const filter = { tenantId, recipientUserId: userId, channel: 'IN_APP', readAt: null };
  if (!markAll && notificationId) filter._id = notificationId;
  return Notification.updateMany(filter, { $set: { readAt: new Date() } });
}

module.exports = { createNotification, getMailTransport, deliverNotification, buildDigestNotifications, notifyUsers, getUnreadCount, markNotificationRead };
