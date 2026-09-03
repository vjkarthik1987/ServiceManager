# Upgrade to Service Desk v21

Service Desk v21 is designed for the `suntec` cloud-UAT workspace. No destructive database migration is required.

## Recommended path

1. Back up the current database or use the bootstrap backup.
2. Copy your existing `.env` into the v21 directory.
3. Install dependencies with `npm install`.
4. Validate the bootstrap catalogue:

```powershell
npm run bootstrap:suntec -- --validate-only
```

5. Preview the complete bootstrap without writing data:

```powershell
npm run bootstrap:suntec
```

6. Confirm the target is `suntec`, Standard Bank is the normal-support root, and Danske Bank is the SaaS root. Then apply:

```powershell
npm run bootstrap:suntec -- --apply
```

7. Start the application:

```powershell
npm.cmd start
```

## What the v21 bootstrap adds or updates

- Four Issue Families and their subtypes, workflows, transitions, task templates and support paths.
- Xelerate product and service-desk capability modules.
- Standard Bank + Retail/Corporate with Ticket-only direct-to-L3 support.
- Danske Bank + Retail/Corporate with SaaS Incident/Maintenance/Service Request support.
- Family SLA mappings: Standard Bank Ticket → Gold; Danske Incident → Xelerate SaaS Sample.
- Normal-support L3 team, SaaS Partner/L2 and L3 test identities.
- Sudheer Padiyar and Madhu M as Engagement Managers for both portfolios.
- 180 stable historical UAT requests, 30 per client record across six clients.

The bootstrap is idempotent: seeded request numbers are stable (`<CLIENT>-H0001` through `H0030`) and are not duplicated when the command is rerun.

## UI changes

- Sidebar uses `Requests`; home CTA uses `See requests`.
- `Requests assigned to me` quick filter.
- Redesigned Filters page and compact saved-filter visibility selector.
- Active-filter banner on Requests when navigated from Filters.
- Family-specific SLA controls on Client Configuration.
- Expanded Help & FAQ.

## Mail

SMTP can remain in console mode for UAT if cloud mail delivery is not yet reliable. Activation/access links printed in the application console remain usable.
