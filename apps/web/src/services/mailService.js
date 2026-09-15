import nodemailer from 'nodemailer';
import { config } from '../config.js';

let cachedTransporter = null;

function hasOffice365Config() {
  return Boolean(config.mail.office365Email && config.mail.office365Password);
}

function mailEnabled() {
  // If Office 365 credentials are present, send via SMTP even when MAIL_MODE was not set.
  // MAIL_MODE=console still forces console-only behavior for local testing.
  return config.mail.mode === 'smtp' && hasOffice365Config();
}

function sanitizeHeader(value) {
  return String(value || '')
    .replace(/[\r\n]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function sanitizeEmail(value) {
  return sanitizeHeader(value).replace(/[<>]/g, '').trim();
}

function transporter() {
  if (!cachedTransporter) {
    cachedTransporter = nodemailer.createTransport({
      host: config.mail.smtpHost || 'smtp.office365.com',
      port: config.mail.smtpPort || 587,
      secure: false,
      requireTLS: true,
      name: 'service-desk.local',
      auth: {
        user: config.mail.office365Email,
        pass: config.mail.office365Password
      },
      family: config.mail.smtpFamily,
      connectionTimeout: config.mail.connectionTimeoutMs,
      greetingTimeout: config.mail.greetingTimeoutMs,
      socketTimeout: config.mail.socketTimeoutMs,
      tls: { minVersion: 'TLSv1.2' },
      disableFileAccess: true,
      disableUrlAccess: true
    });
  }
  return cachedTransporter;
}

function subjectWithRedirect(originalTo, subject) {
  const to = sanitizeEmail(originalTo) || 'unknown-recipient';
  const safeSubject = sanitizeHeader(subject || 'Service Desk notification');
  return `[To: ${to}] ${safeSubject}`;
}

function consoleMail({ originalTo, actualTo, subject, text, html, reason = '' }) {
  console.log('\n--------------------------------------------------');
  console.log('[mail] Service Desk email');
  if (reason) console.log(`Mode: ${reason}`);
  console.log(`Original To: ${originalTo || 'not set'}`);
  console.log(`Actual To: ${actualTo || 'not set'}`);
  console.log(`Subject: ${subject}`);
  console.log('Body:');
  console.log(text || html || '');
  console.log('--------------------------------------------------\n');
}

export async function sendServiceMail({ to, subject, text, html }) {
  const originalTo = sanitizeEmail(to);
  const actualTo = sanitizeEmail(config.mail.redirectTo || originalTo);
  const safeSubject = subjectWithRedirect(originalTo, subject);
  const bodyText = text || String(html || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

  if (!mailEnabled()) {
    consoleMail({
      originalTo,
      actualTo,
      subject: safeSubject,
      text: bodyText,
      html,
      reason: hasOffice365Config()
        ? 'console mode forced by MAIL_MODE=console'
        : 'console fallback - Office 365 SMTP not configured'
    });
    return { ok: false, mode: 'console', skipped: true };
  }

  const attempts = Math.max(1, Number(config.mail.retryAttempts || 2));
  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const info = await transporter().sendMail({
        from: `"${sanitizeHeader(config.mail.fromName)}" <${sanitizeEmail(config.mail.smtpFrom)}>`,
        to: actualTo,
        subject: safeSubject,
        text: bodyText,
        html
      });
      console.log(`[mail] Sent ${info.messageId || ''} to ${actualTo} for original recipient ${originalTo || 'not set'}${attempt > 1 ? ` on attempt ${attempt}` : ''}`);
      return { ok: true, mode: 'smtp', messageId: info.messageId || '', attempts: attempt, actualTo, originalTo };
    } catch (error) {
      lastError = error;
      console.error(`[mail] SMTP attempt ${attempt}/${attempts} failed for ${actualTo}: ${error.message}`);
      try { cachedTransporter?.close?.(); } catch {}
      cachedTransporter = null;
      if (attempt < attempts && config.mail.retryDelayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, config.mail.retryDelayMs));
      }
    }
  }

  const error = lastError || new Error('Unknown SMTP error');
  console.error('[mail] Failed to send email after retries');
  console.error(`To: ${actualTo}`);
  console.error(`Original recipient: ${originalTo || 'not set'}`);
  console.error(`Subject: ${safeSubject}`);
  console.error(`Error: ${error.message}`);
  if (error.stack) console.error(error.stack);
  consoleMail({ originalTo, actualTo, subject: safeSubject, text: bodyText, html, reason: 'SMTP error fallback' });
  return { ok: false, mode: 'smtp', error: error.message, attempts, actualTo, originalTo };
}

export function mailStatus() {
  return {
    mode: config.mail.mode,
    effectiveMode: mailEnabled() ? 'smtp' : 'console',
    smtpConfigured: hasOffice365Config(),
    redirectTo: config.mail.redirectTo,
    from: config.mail.smtpFrom,
    smtpFamily: config.mail.smtpFamily,
    connectionTimeoutMs: config.mail.connectionTimeoutMs,
    socketTimeoutMs: config.mail.socketTimeoutMs,
    retryAttempts: config.mail.retryAttempts,
    publicBaseUrl: config.mail.publicBaseUrl
  };
}
