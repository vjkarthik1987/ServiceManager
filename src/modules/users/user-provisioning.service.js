const { getMailTransport } = require('../notifications/notification.service');
const { buildProvisioningEmail, buildProvisioningTrackingEmail, buildPasswordResetEmail } = require('../notifications/email-template.service');
const { logInfo, logError } = require('../../utils/logger');

function getProvisioningTrackingRecipient(tenant = null) {
  return String(
    tenant?.notificationConfig?.userProvisioningTrackingEmail
      || process.env.USER_PROVISIONING_TRACKING_EMAIL
      || process.env.USER_PROVISIONING_EMAIL
      || ''
  ).trim().toLowerCase();
}

async function sendNewUserProvisioningEmail({ tenant, user, password, createdByUser = null }) {
  const recipient = String(user?.email || '').trim().toLowerCase();
  const trackingRecipient = getProvisioningTrackingRecipient(tenant);
  if (!recipient) {
    return { delivered: false, skipped: true, reason: 'recipient_not_configured' };
  }

  const primaryEmail = buildProvisioningEmail({ tenant, user, password, createdByUser });
  const trackingEmail = buildProvisioningTrackingEmail({
    tenant,
    user,
    createdByUser,
    primaryRecipient: recipient
  });

  const mailer = getMailTransport();
  if (!mailer) {
    logInfo('user_provisioning_email_skipped', {
      recipient,
      trackingRecipient,
      userEmail: user.email,
      reason: 'smtp_not_configured'
    });
    return {
      delivered: false,
      trackingDelivered: false,
      skipped: true,
      reason: 'smtp_not_configured',
      recipient,
      trackingRecipient
    };
  }

  try {
    await mailer.sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER || 'esop@localhost',
      to: recipient,
      subject: primaryEmail.subject,
      text: primaryEmail.text,
      html: primaryEmail.html,
      headers: { 'X-Service-Desk-Notification-Type': 'USER_PROVISIONING' }
    });
    logInfo('user_provisioning_email_sent', { recipient, userEmail: user.email });

    let trackingDelivered = false;
    if (trackingRecipient && trackingRecipient !== recipient) {
      await mailer.sendMail({
        from: process.env.SMTP_FROM || process.env.SMTP_USER || 'esop@localhost',
        to: trackingRecipient,
        subject: trackingEmail.subject,
        text: trackingEmail.text,
        html: trackingEmail.html,
        headers: { 'X-Service-Desk-Notification-Type': 'USER_PROVISIONING_TRACKING' }
      });
      trackingDelivered = true;
      logInfo('user_provisioning_tracking_email_sent', { recipient: trackingRecipient, userEmail: user.email });
    }

    return { delivered: true, trackingDelivered, recipient, trackingRecipient };
  } catch (error) {
    const reason = [error.code, error.command, error.responseCode, error.message].filter(Boolean).join(' | ');
    logError('user_provisioning_email_failed', {
      recipient,
      trackingRecipient,
      userEmail: user.email,
      message: reason
    });
    return {
      delivered: false,
      trackingDelivered: false,
      skipped: false,
      reason,
      recipient,
      trackingRecipient
    };
  }
}

async function sendForgotPasswordEmail({ tenant, user, resetUrl }) {
  const recipient = String(user?.email || '').trim().toLowerCase();
  const mailer = getMailTransport();
  if (!mailer) {
    logInfo('forgot_password_email_skipped', { recipient, userEmail: user.email, reason: 'smtp_not_configured' });
    return { delivered: false, skipped: true, reason: 'smtp_not_configured', recipient };
  }

  const resetEmail = buildPasswordResetEmail({ tenant, user, resetUrl });

  try {
    await mailer.sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER || 'esop@localhost',
      to: recipient,
      subject: resetEmail.subject,
      text: resetEmail.text,
      html: resetEmail.html,
      headers: { 'X-Service-Desk-Notification-Type': 'PASSWORD_RESET' }
    });
    logInfo('forgot_password_email_sent', { recipient, userEmail: user.email });
    return { delivered: true, recipient };
  } catch (error) {
    const reason = [error.code, error.command, error.responseCode, error.message].filter(Boolean).join(' | ');
    logError('forgot_password_email_failed', { recipient, userEmail: user.email, message: reason });
    return { delivered: false, skipped: false, reason, recipient };
  }
}

module.exports = { sendNewUserProvisioningEmail, sendForgotPasswordEmail, getProvisioningTrackingRecipient };
