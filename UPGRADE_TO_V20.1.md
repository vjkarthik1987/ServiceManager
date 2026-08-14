# Upgrade to v20.1

v20.1 is compatible with the v20 database and service model.

1. Stop v20.
2. Extract `service-desk-v20.1.zip` into a new folder, or apply the v20.1 patch to v20.
3. Copy your existing `.env` file.
4. Keep your existing SMTP settings. Recommended additions:

```env
MAIL_RETRY_ATTEMPTS=2
MAIL_RETRY_DELAY_MS=750
# Leave blank for local Host-header links, or set your public Service Desk URL.
PUBLIC_BASE_URL=
```

5. Start the application:

```powershell
npm.cmd start
```

No database migration or provisioning rerun is required.

## Registration-mail UAT

1. Create a test user from Admin → Users.
2. Confirm the success notice says the invitation was sent (or gives an explicit SMTP error).
3. If needed, click **Send access email** for that user and confirm the one-time access/reset message arrives.
4. For a fresh workspace-registration test, create a pending workspace and confirm the setup page reports SMTP delivery. If it fails, use **Resend activation email**; the workspace should not need to be recreated.
