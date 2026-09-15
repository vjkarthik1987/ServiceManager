# Upgrade to Service Desk v20.2

v20.2 is designed as the first clean cloud-database baseline for the `suntec` tenant. No destructive database migration is required.

## 1. Configure the cloud database

Copy your existing `.env` and point `MONGO_URI` at the cloud MongoDB database. Keep the workspace slug as `suntec`.

## 2. Install and start once

```powershell
npm install
npm.cmd start
```

Confirm the application connects to the cloud database, then stop it before running the bootstrap if you prefer a quieter console.

## 3. Validate the bootstrap catalogue

```powershell
npm run bootstrap:suntec -- --validate-only
```

## 4. Preview the database changes

```powershell
npm run bootstrap:suntec
```

The bootstrap is dry-run by default. Check that the target organization shown is the `suntec` workspace.

## 5. Apply

```powershell
npm run bootstrap:suntec -- --apply
```

The script writes a backup under `backups/suntec-cloud-bootstrap/` before modifying data.

For newly created UAT support users, a temporary password is printed once in the terminal. Each user must change it at first sign-in.

## 6. Start the application

```powershell
npm.cmd start
```

Hard-refresh the browser once after upgrading.

## What the bootstrap creates

- Xelerate product and its service-desk capability modules.
- Four Issue Families and their subtypes.
- Statuses, workflow transitions, task templates, support paths and SLA templates.
- Standard Bank, Standard Bank Retail Banking and Standard Bank Corporate Banking.
- Danske Bank, Danske Bank Retail Banking and Danske Bank Corporate Banking.
- Client-to-Issue-Family assignments and child inheritance.
- Standard Bank Ticket requests routed directly to SunTec L3 Operations, without a customer operational task stage.
- Danske SaaS support routing according to the configured Incident, Maintenance Request and Service Request process models.
- UAT agent/manager/partner identities and client scopes.

## Mail

If SMTP is unavailable, console-generated activation/reset links continue to work for UAT. Mail transport can be fixed independently of the service-model bootstrap.
