# Upgrade to v20

v20 is compatible with the v19.8.9 database and provisioning model.

1. Stop the current Service Desk process.
2. Extract `service-desk-v20.zip` into a new folder.
3. Copy your existing `.env` into the v20 folder.
4. From the v20 folder run:

```powershell
npm install
npm.cmd start
```

5. In Chrome use `Ctrl + Shift + R` once so the updated browser JavaScript and CSS are loaded.

No database migration is required. Re-run `provision:suntecsds-service-model` only if you separately want to change configuration; it is not required for the v20 fixes.

## Quick validation

- Open a request and post a comment. It should render correctly immediately without refresh.
- Open Assign/Reassign. If your logged-in identity is eligible for that stage, it should be the first option and start with `Me ·`.
- Assign the stage to yourself. The ownership card should show `Me`.
