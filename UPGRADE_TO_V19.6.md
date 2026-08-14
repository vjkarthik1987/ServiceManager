# Upgrade to Service Desk v19.6

1. Stop the running v19.5 processes.
2. Keep a backup of the v19.5 folder and its `.env` file.
3. Extract `service-desk-v19.6.zip` into a new folder.
4. Copy the existing `.env` into the v19.6 root so the same MongoDB data and credentials are used.
5. For local UAT, set:

   ```env
   MAIL_MODE=console
   ```

   SMTP can be enabled later with `MAIL_MODE=smtp`.
6. Run:

   ```powershell
   npm install
   npm run dev
   ```

No database migration is required for v19.6. Existing clients, workflows, imported task templates, support paths and requests remain in the same MongoDB database.

## First verification

- Open the existing Example Bank request.
- Change a valid workflow status once.
- The button should change to `Updating…`, the request page should return promptly, and a green success message should appear.
- Re-submitting a stale form should return to the request with a clear refresh message rather than a generic error page.
- A required support-movement comment shorter than three characters should be rejected by the browser before submission.
