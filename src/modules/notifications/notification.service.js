const nodemailer = require('nodemailer');
const { Notification } = require('./notification.model');
const { User } = require('../users/user.model');
const { Tenant } = require('../tenant/tenant.model');
const { canSendNotification } = require('./notification-preference.service');
const { buildNotificationEmail, buildTestEmail } = require('./email-template.service');
const { logInfo, logError } = require('../../utils/logger');

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
  const port = Number(process.env.SMTP_PORT || 587);
  const secure = String(process.env.SMTP_SECURE || 'false') === 'true' || port === 465;
  transport = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS || '' } : undefined,
    connectionTimeout: Number(process.env.SMTP_CONNECTION_TIMEOUT_MS || 10000),
    greetingTimeout: Number(process.env.SMTP_GREETING_TIMEOUT_MS || 10000),
    socketTimeout: Number(process.env.SMTP_SOCKET_TIMEOUT_MS || 15000),
    pool: String(process.env.SMTP_POOL || 'false') === 'true',
    maxConnections: Number(process.env.SMTP_MAX_CONNECTIONS || 2),
    maxMessages: Number(process.env.SMTP_MAX_MESSAGES || 50),
    tls: String(process.env.SMTP_TLS_REJECT_UNAUTHORIZED || 'true') === 'false' ? { rejectUnauthorized: false } : undefined
  });
  return transport;
}

async function resolveTenant(tenantId) {
  if (!tenantId) return null;
  return Tenant.findById(tenantId).lean().catch(() => null);
}

function summarizeMailError(error) {
  return [error?.code, error?.command, error?.responseCode, error?.message].filter(Boolean).join(' | ');
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
  await enqueueJob({ tenantId, type: 'NOTIFICATION_DELIVERY', payload: { notificationId: notification._id }, maxAttempts: Number(process.env.EMAIL_MAX_ATTEMPTS || 5) });
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
    const tenant = await resolveTenant(notification.tenantId);
    const email = buildNotificationEmail({ tenant, notification });
    await mailer.sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER || 'esop@localhost',
      to: notification.recipientEmail,
      subject: email.subject || notification.subject,
      text: email.text,
      html: email.html,
      headers: { 'X-Service-Desk-Notification-Type': notification.type }
    });
    notification.status = 'SENT';
    notification.sentAt = new Date();
    notification.failureReason = '';
    logInfo('notification_email_sent', { notificationId: String(notification._id), to: notification.recipientEmail, type: notification.type });
  } catch (error) {
    notification.status = 'FAILED';
    notification.failureReason = summarizeMailError(error);
    notification.retryCount = (notification.retryCount || 0) + 1;
    notification.nextAttemptAt = new Date(Date.now() + Math.min(notification.retryCount, 5) * 10 * 60 * 1000);
    logError('notification_email_failed', { notificationId: String(notification._id), to: notification.recipientEmail, type: notification.type, message: notification.failureReason });
  }
  await notification.save();
  return notification;
}

async function sendBrandedTestEmail({ tenant = null, recipientEmail = '', actorUser = null } = {}) {
  const recipient = String(recipientEmail || actorUser?.email || '').trim();
  if (!recipient) return { delivered: false, reason: 'recipient_required' };
  const mailer = getMailTransport();
  if (!mailer) return { delivered: false, reason: 'smtp_not_configured', recipient };
  const email = buildTestEmail({ tenant, recipient });
  try {
    await mailer.sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER || 'esop@localhost',
      to: recipient,
      subject: email.subject,
      text: email.text,
      html: email.html,
      headers: { 'X-Service-Desk-Notification-Type': 'TEST_EMAIL' }
    });
    logInfo('test_email_sent', { recipient, actor: actorUser?.email || '' });
    return { delivered: true, recipient };
  } catch (error) {
    const reason = summarizeMailError(error);
    logError('test_email_failed', { recipient, message: reason });
    return { delivered: false, reason, recipient };
  }
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

module.exports = { createNotification, getMailTransport, deliverNotification, buildDigestNotifications, notifyUsers, getUnreadCount, markNotificationRead, sendBrandedTestEmail };
