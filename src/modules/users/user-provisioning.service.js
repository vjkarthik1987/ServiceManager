const { getMailTransport } = require('../notifications/notification.service');
const { logInfo, logError } = require('../../utils/logger');

function getProvisioningRecipient() {
  return String(process.env.USER_PROVISIONING_EMAIL || 'karthikvj@suntecsbs.com').trim();
}

async function sendNewUserProvisioningEmail({ tenant, user, password, createdByUser = null }) {
  const recipient = getProvisioningRecipient();
  if (!recipient) return { delivered: false, skipped: true, reason: 'recipient_not_configured' };

  const subject = `ESOP user created · ${user.email}`;
  const lines = [
    'A new ESOP user has been created.',
    '',
    `Workspace: ${tenant?.name || tenant?.slug || 'Unknown'}`,
    `Tenant slug: ${tenant?.slug || 'Unknown'}`,
    `User name: ${user.name}`,
    `User email: ${user.email}`,
    `Role: ${user.role}`,
    `Temporary password: ${password}`,
    '',
    'Please share/reset this password securely and ask the user to change it after first login.'
  ];

  if (createdByUser) {
    lines.splice(8, 0, `Created by: ${createdByUser.name || 'Unknown'} <${createdByUser.email || 'unknown'}>`);
  }

  const text = lines.join('\n');
  const mailer = getMailTransport();

  if (!mailer) {
    logInfo('user_provisioning_email_skipped', { recipient, userEmail: user.email, reason: 'smtp_not_configured' });
    return { delivered: false, skipped: true, reason: 'smtp_not_configured', recipient };
  }

  try {
    await mailer.sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER || 'esop@localhost',
      to: recipient,
      subject,
      text
    });
    logInfo('user_provisioning_email_sent', { recipient, userEmail: user.email });
    return { delivered: true, recipient };
  } catch (error) {
    logError('user_provisioning_email_failed', { recipient, userEmail: user.email, message: error.message });
    return { delivered: false, skipped: false, reason: error.message, recipient };
  }
}



async function sendForgotPasswordEmail({ tenant, user, resetUrl }) {
  const recipient = getProvisioningRecipient();
  const mailer = getMailTransport();
  if (!mailer) {
    logInfo('forgot_password_email_skipped', { recipient, userEmail: user.email, reason: 'smtp_not_configured' });
    return { delivered: false, skipped: true, reason: 'smtp_not_configured', recipient };
  }

  const subject = `Reset your ESOP password · ${tenant?.name || tenant?.slug || 'Workspace'}`;
  const text = [
    `Hello ${user.name || 'there'},`,
    '',
    `A password reset was requested for your ESOP account in ${tenant?.name || tenant?.slug || 'this workspace'}.`,
    '',
    'Use the link below to reset your password. This link expires in 30 minutes.',
    resetUrl,
    '',
    'If you did not request this, you can safely ignore this email.'
  ].join('\n');

  try {
    await mailer.sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER || 'esop@localhost',
      to: recipient,
      subject,
      text
    });
    logInfo('forgot_password_email_sent', { recipient, userEmail: user.email });
    return { delivered: true, recipient };
  } catch (error) {
    logError('forgot_password_email_failed', { recipient, userEmail: user.email, message: error.message });
    return { delivered: false, skipped: false, reason: error.message, recipient };
  }
}

module.exports = { sendNewUserProvisioningEmail, sendForgotPasswordEmail, getProvisioningRecipient };
