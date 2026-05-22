function escapeHtml(value = '') {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function getAppBaseUrl(tenant = null) {
  const explicit = String(process.env.PUBLIC_APP_URL || process.env.BASE_URL || '').trim().replace(/\/+$/, '');
  if (explicit) return explicit;
  const slug = tenant?.slug ? `/${tenant.slug}` : '';
  return `http://localhost:${process.env.PORT || 3000}${slug}`.replace(/\/+$/, '');
}

function tenantLabel(tenant = null) {
  return tenant?.name || tenant?.slug || process.env.TENANT_NAME || 'Service Desk';
}

function issueUrl({ tenant = null, issueId = '', issueNumber = '' } = {}) {
  const base = getAppBaseUrl(tenant).replace(/\/+$/, '');
  const slug = tenant?.slug ? `/${tenant.slug}` : '';
  const normalizedBase = base.endsWith(slug) ? base : `${base}${slug}`;
  if (issueId) return `${normalizedBase}/tickets/${issueId}`;
  return normalizedBase;
}

function dashboardUrl({ tenant = null } = {}) {
  const base = getAppBaseUrl(tenant).replace(/\/+$/, '');
  const slug = tenant?.slug ? `/${tenant.slug}` : '';
  return base.endsWith(slug) ? `${base}/dashboards` : `${base}${slug}/dashboards`;
}

function getAccentColor(tenant = null) {
  return tenant?.accentColor || tenant?.theme?.accentColor || process.env.TENANT_ACCENT_COLOR || '#7C3AED';
}

function statusLabel(value = '') {
  return String(value || '').replace(/_/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase());
}

function buildPlainTextFromEmailModel(model) {
  const lines = [
    model.preheader,
    '',
    model.title,
    model.intro,
    '',
    ...(model.facts || []).map((fact) => `${fact.label}: ${fact.value}`),
    '',
    model.nextStep,
    model.ctaUrl ? `${model.ctaLabel}: ${model.ctaUrl}` : '',
    '',
    `${model.workspace} · Service Desk`
  ];
  return lines.filter((line) => line !== undefined && line !== null).join('\n');
}

function renderBrandedEmail(model) {
  const accent = model.accentColor || '#7C3AED';
  const mint = '#00C2A8';
  const yellow = '#FFE66D';
  const text = '#1F2937';
  const bg = '#F8FAFC';
  const facts = (model.facts || []).filter((fact) => fact && fact.value !== undefined && fact.value !== null && String(fact.value).trim() !== '');
  const secondaryCta = model.secondaryCtaUrl ? `
    <a href="${escapeHtml(model.secondaryCtaUrl)}" style="display:inline-block;margin-left:10px;color:${accent};font-weight:700;text-decoration:none;">${escapeHtml(model.secondaryCtaLabel || 'Open dashboard')} →</a>` : '';

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${escapeHtml(model.subject || model.title || 'Service Desk')}</title>
</head>
<body style="margin:0;padding:0;background:${bg};font-family:Inter,Segoe UI,Roboto,Arial,sans-serif;color:${text};">
  <span style="display:none!important;visibility:hidden;opacity:0;color:transparent;height:0;width:0;overflow:hidden;">${escapeHtml(model.preheader || '')}</span>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:${bg};padding:28px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:680px;background:#ffffff;border:1px solid #E5E7EB;border-radius:24px;overflow:hidden;box-shadow:0 20px 60px rgba(31,41,55,.10);">
          <tr>
            <td style="padding:0;background:linear-gradient(135deg,${mint} 0%,${accent} 70%);height:8px;"></td>
          </tr>
          <tr>
            <td style="padding:30px 30px 18px 30px;">
              <div style="font-size:13px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:${accent};">${escapeHtml(model.workspace || 'Service Desk')}</div>
              <h1 style="margin:12px 0 8px 0;font-size:28px;line-height:1.16;color:${text};font-weight:850;">${escapeHtml(model.title || 'Something needs your attention')}</h1>
              <p style="margin:0;color:#4B5563;font-size:16px;line-height:1.55;">${escapeHtml(model.intro || '')}</p>
            </td>
          </tr>
          <tr>
            <td style="padding:8px 30px 0 30px;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border:1px solid #E5E7EB;border-radius:18px;background:#FBFDFF;">
                <tr>
                  <td style="padding:20px;">
                    <div style="font-size:12px;text-transform:uppercase;letter-spacing:.08em;color:#6B7280;font-weight:800;margin-bottom:10px;">Issue snapshot</div>
                    <div style="font-size:22px;line-height:1.25;font-weight:850;color:${text};margin-bottom:6px;">${escapeHtml(model.issueNumber || 'Workspace update')}</div>
                    <div style="font-size:15px;line-height:1.5;color:#4B5563;margin-bottom:16px;">${escapeHtml(model.issueTitle || model.summary || 'Open the workspace for details.')}</div>
                    <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                      ${facts.map((fact) => `
                      <tr>
                        <td style="padding:8px 0;border-top:1px solid #EEF2F7;color:#6B7280;font-size:13px;width:38%;">${escapeHtml(fact.label)}</td>
                        <td style="padding:8px 0;border-top:1px solid #EEF2F7;color:${text};font-size:13px;font-weight:700;">${escapeHtml(fact.value)}</td>
                      </tr>`).join('')}
                    </table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          ${model.callout ? `
          <tr>
            <td style="padding:18px 30px 0 30px;">
              <div style="background:${yellow};border-radius:16px;padding:14px 16px;color:${text};font-size:14px;line-height:1.5;font-weight:700;">${escapeHtml(model.callout)}</div>
            </td>
          </tr>` : ''}
          <tr>
            <td style="padding:24px 30px 30px 30px;">
              <p style="margin:0 0 18px 0;color:#4B5563;font-size:15px;line-height:1.55;">${escapeHtml(model.nextStep || 'Open the workspace to review the latest details.')}</p>
              ${model.ctaUrl ? `<a href="${escapeHtml(model.ctaUrl)}" style="display:inline-block;background:${accent};color:#ffffff;text-decoration:none;font-size:15px;font-weight:850;padding:13px 20px;border-radius:999px;box-shadow:0 10px 24px rgba(124,58,237,.25);">${escapeHtml(model.ctaLabel || 'Open Service Desk')}</a>${secondaryCta}` : ''}
            </td>
          </tr>
          <tr>
            <td style="padding:18px 30px 28px 30px;border-top:1px solid #EEF2F7;background:#FCFCFD;">
              <p style="margin:0;color:#6B7280;font-size:12px;line-height:1.55;">Smart, calm service orchestration from ${escapeHtml(model.workspace || 'Service Desk')}. You are receiving this because this item is in your permitted workspace scope.</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function buildIssueEmailModel({ type = '', tenant = null, notification = null, metadata = {} } = {}) {
  const workspace = tenantLabel(tenant);
  const issueNumber = metadata.issueNumber || notification?.metadata?.issueNumber || 'Issue';
  const issueId = metadata.issueId || notification?.metadata?.issueId || notification?.issueId || '';
  const issueTitle = metadata.issueTitle || metadata.title || '';
  const status = metadata.status || metadata.afterStatus || '';
  const severity = metadata.severity || metadata.priority || '';
  const actorName = metadata.actorName || '';
  const url = metadata.ctaUrl || issueUrl({ tenant, issueId, issueNumber });
  const dash = dashboardUrl({ tenant });
  const base = {
    workspace,
    accentColor: getAccentColor(tenant),
    issueNumber,
    issueTitle,
    ctaUrl: url,
    secondaryCtaUrl: dash,
    secondaryCtaLabel: 'Open dashboard',
    facts: [
      { label: 'Status', value: status ? statusLabel(status) : '' },
      { label: 'Severity', value: severity },
      { label: 'Product', value: metadata.product || '' },
      { label: 'Entity', value: metadata.entityName || metadata.entityPath || '' },
      { label: 'Assigned to', value: metadata.assignedToName || '' },
      { label: 'Updated by', value: actorName }
    ]
  };

  const map = {
    ISSUE_CREATED: {
      title: `${issueNumber} is now in motion`,
      preheader: `A new issue has been created in ${workspace}.`,
      intro: notification?.body || 'A new issue has been created and is ready for triage.',
      ctaLabel: 'View issue',
      nextStep: 'Review the issue, validate the details, and move it to the right owner or execution path.',
      callout: 'Fresh ticket. Clean handoff. No detective work.'
    },
    ISSUE_ASSIGNED: {
      title: `${issueNumber} has an owner`,
      preheader: `An issue has been assigned in ${workspace}.`,
      intro: notification?.body || 'This issue has been assigned for action.',
      ctaLabel: 'Review assignment',
      nextStep: 'Open the issue to confirm context, next action, SLA position, and any customer-facing update needed.',
      callout: 'Ownership is clear. Momentum starts here.'
    },
    ISSUE_STATUS_CHANGED: {
      title: `${issueNumber} moved forward`,
      preheader: `Issue status changed in ${workspace}.`,
      intro: notification?.body || 'The issue status has changed.',
      ctaLabel: 'Track issue',
      nextStep: 'Open the issue to see the latest status, comments, and next action.',
      callout: metadata.afterStatus === 'WAITING_FOR_CLIENT' ? 'Customer input is now the critical path.' : 'Status changed. Everyone stays aligned.'
    },
    ISSUE_REOPENED: {
      title: `${issueNumber} was reopened`,
      preheader: `An issue was reopened in ${workspace}.`,
      intro: notification?.body || 'This issue has been reopened and needs attention.',
      ctaLabel: 'Review reopened issue',
      nextStep: 'Check the reason for reopening and decide the next corrective action.',
      callout: 'Reopened does not mean chaos. It means sharper closure.'
    },
    ISSUE_COMMENT_ADDED: {
      title: `New comment on ${issueNumber}`,
      preheader: `A new comment was added in ${workspace}.`,
      intro: notification?.body || 'A new comment was added to the issue.',
      ctaLabel: 'Read comment',
      nextStep: 'Open the issue to read the comment and respond if needed.',
      callout: 'A small comment can unblock a big delay.'
    },
    SLA_RESPONSE_BREACHED: {
      title: `Response SLA breached for ${issueNumber}`,
      preheader: `Response SLA breach in ${workspace}.`,
      intro: notification?.body || 'The response commitment has breached.',
      ctaLabel: 'Act on SLA breach',
      nextStep: 'Open the issue, add an internal note, and plan the next customer update.',
      callout: 'This needs visible ownership now.'
    },
    SLA_RESOLUTION_BREACHED: {
      title: `Resolution SLA breached for ${issueNumber}`,
      preheader: `Resolution SLA breach in ${workspace}.`,
      intro: notification?.body || 'The resolution commitment has breached.',
      ctaLabel: 'Review breach',
      nextStep: 'Open the issue to review bottlenecks, current owner, and recovery action.',
      callout: 'Recovery beats silence. Send the next meaningful update.'
    },
    JIRA_PUSH_SUCCESS: {
      title: `${issueNumber} is now in Jira`,
      preheader: `Jira sync completed in ${workspace}.`,
      intro: notification?.body ? `Jira key: ${notification.body}` : 'The issue was pushed to Jira successfully.',
      ctaLabel: 'View Service Desk issue',
      nextStep: 'Track execution from Service Desk while Jira handles delivery.',
      callout: 'Orchestration here. Execution there. Visibility everywhere.'
    },
    AGENT_CLOSURE_REQUIRED: {
      title: `Closure review needed for ${issueNumber}`,
      preheader: `Jira is done; Service Desk closure review is needed.`,
      intro: notification?.body || 'Jira is in a completed state and Service Desk needs agent closure review.',
      ctaLabel: 'Review closure',
      nextStep: 'Verify the resolution, add closure details, and close the issue for the customer.',
      callout: 'Done in Jira is not done for the customer until closure is clean.'
    }
  };

  return { ...base, ...(map[type] || {
    title: notification?.subject || `${issueNumber} needs your attention`,
    preheader: notification?.subject || `Service Desk update from ${workspace}.`,
    intro: notification?.body || 'There is a new Service Desk update.',
    ctaLabel: 'Open Service Desk',
    nextStep: 'Open the workspace to review the latest details.'
  }), subject: notification?.subject || (map[type]?.title || `${issueNumber} needs your attention`) };
}

function buildProvisioningEmail({ tenant = null, user, password, createdByUser = null } = {}) {
  const workspace = tenantLabel(tenant);
  const base = getAppBaseUrl(tenant).replace(/\/+$/, '');
  const slug = tenant?.slug ? `/${tenant.slug}` : '';
  const loginUrl = base.endsWith(slug) ? `${base}/login` : `${base}${slug}/login`;
  const model = {
    workspace,
    accentColor: getAccentColor(tenant),
    subject: `Welcome to ${workspace} Service Desk`,
    title: `Welcome, ${user?.name || 'there'} 👋`,
    preheader: `Your ${workspace} Service Desk account is ready.`,
    intro: 'Your Service Desk account has been created. Use the temporary password below to sign in and change it after first login.',
    issueNumber: 'Account ready',
    issueTitle: 'A calmer, sharper service workspace is ready for you.',
    ctaUrl: loginUrl,
    ctaLabel: 'Sign in now',
    nextStep: 'Sign in with your temporary password, then update your password from your profile.',
    callout: `Temporary password: ${password}`,
    facts: [
      { label: 'Workspace', value: workspace },
      { label: 'Tenant slug', value: tenant?.slug || '' },
      { label: 'User email', value: user?.email || '' },
      { label: 'Role', value: user?.role || '' },
      { label: 'Created by', value: createdByUser ? `${createdByUser.name || 'Unknown'} <${createdByUser.email || 'unknown'}>` : '' }
    ]
  };
  return { subject: model.subject, html: renderBrandedEmail(model), text: buildPlainTextFromEmailModel(model) };
}


function buildProvisioningTrackingEmail({ tenant = null, user, createdByUser = null, primaryRecipient = '' } = {}) {
  const workspace = tenantLabel(tenant);
  const model = {
    workspace,
    accentColor: getAccentColor(tenant),
    subject: `New user created · ${workspace} Service Desk`,
    title: 'New workspace user created',
    preheader: `${user?.name || user?.email || 'A user'} was created in ${workspace}.`,
    intro: 'A Service Desk user account was created. This is an operational copy for admin visibility; the user receives the actual welcome email separately.',
    issueNumber: 'User provisioning',
    issueTitle: `${user?.name || 'New user'} · ${user?.email || primaryRecipient || ''}`,
    ctaUrl: dashboardUrl({ tenant }),
    ctaLabel: 'Open admin console',
    nextStep: 'Open the Admin Console to review users, roles, entity scope, and provisioning hygiene.',
    callout: 'Admin visibility without scary plain-text system mails.',
    facts: [
      { label: 'Workspace', value: workspace },
      { label: 'Tenant slug', value: tenant?.slug || '' },
      { label: 'User name', value: user?.name || '' },
      { label: 'User email', value: user?.email || primaryRecipient || '' },
      { label: 'Role', value: user?.role || '' },
      { label: 'Created by', value: createdByUser ? `${createdByUser.name || 'Unknown'} <${createdByUser.email || 'unknown'}>` : '' },
      { label: 'Created at', value: new Date().toISOString() }
    ]
  };
  return { subject: model.subject, html: renderBrandedEmail(model), text: buildPlainTextFromEmailModel(model) };
}

function buildPasswordResetEmail({ tenant = null, user, resetUrl } = {}) {
  const workspace = tenantLabel(tenant);
  const model = {
    workspace,
    accentColor: getAccentColor(tenant),
    subject: `Reset your ${workspace} Service Desk password`,
    title: 'Password reset requested',
    preheader: `Reset your ${workspace} Service Desk password.`,
    intro: 'A password reset was requested for your Service Desk account. This link expires in 30 minutes.',
    issueNumber: 'Password reset',
    issueTitle: user?.email || 'Account security action',
    ctaUrl: resetUrl,
    ctaLabel: 'Reset password',
    nextStep: 'Use the button to set a new password. You can ignore this email if you did not request it.',
    callout: 'Security note: this reset link is time-bound.',
    facts: [
      { label: 'Workspace', value: workspace },
      { label: 'Account', value: user?.email || '' }
    ]
  };
  return { subject: model.subject, html: renderBrandedEmail(model), text: buildPlainTextFromEmailModel(model) };
}

function buildNotificationEmail({ tenant = null, notification }) {
  const metadata = notification?.metadata || {};
  const model = buildIssueEmailModel({ type: notification?.templateKey || notification?.type, tenant, notification, metadata });
  return { subject: notification?.subject || model.subject, html: renderBrandedEmail(model), text: buildPlainTextFromEmailModel(model) };
}

function buildTestEmail({ tenant = null, recipient = '' } = {}) {
  const workspace = tenantLabel(tenant);
  const model = {
    workspace,
    accentColor: getAccentColor(tenant),
    subject: `Test email · ${workspace} Service Desk`,
    title: 'Your email channel looks sharp',
    preheader: `SMTP is working for ${workspace}.`,
    intro: 'This is a branded test email from Service Desk. If this reached you, SMTP delivery is alive and the new template system is working.',
    issueNumber: 'Email test',
    issueTitle: 'Beautiful, action-ready notifications are enabled.',
    ctaUrl: dashboardUrl({ tenant }),
    ctaLabel: 'Open dashboard',
    nextStep: 'Use this as the baseline for issue, assignment, comment, SLA, and account emails.',
    callout: 'Smart. Friendly. Slightly rebellious. Very much on-brand.',
    facts: [
      { label: 'Recipient', value: recipient },
      { label: 'SMTP host', value: process.env.SMTP_HOST || 'Not configured' },
      { label: 'Timeout', value: `${process.env.SMTP_CONNECTION_TIMEOUT_MS || 10000} ms` }
    ]
  };
  return { subject: model.subject, html: renderBrandedEmail(model), text: buildPlainTextFromEmailModel(model) };
}

module.exports = {
  buildNotificationEmail,
  buildProvisioningEmail,
  buildPasswordResetEmail,
  buildProvisioningTrackingEmail,
  buildTestEmail,
  buildPlainTextFromEmailModel,
  renderBrandedEmail,
  issueUrl,
  dashboardUrl,
  statusLabel
};
