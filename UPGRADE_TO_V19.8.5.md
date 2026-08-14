# Service Desk v19.8.5

This release builds on v19.8.4. No destructive database migration is required.

## What changed

- Client-to-Issue-Family availability is now treated as the authoritative service model for request creation and client routing.
- Root clients can select their Issue Families; child clients can inherit them.
- Removing an Issue Family prunes incompatible client operational rules so stale routing cannot remain active.
- The provisioning script configures Standard Bank (`STDBNK`) as **Ticket only** and its children inherit the same service model.
- The provisioning script creates/maintains a SaaS UAT hierarchy:
  - `SAASBK` — Xelerate SaaS Bank
  - `SAASCO` — Xelerate SaaS Corporate Banking
  - `SAASRT` — Xelerate SaaS Retail Banking
- `SAASBK` is enabled only for **Incident**, **Maintenance Request**, and **Service Request**; children inherit.
- Provisioner-owned routing rules are family-safe: Ticket clients receive only Ticket routing; SaaS clients receive only SaaS routing.
- Request intake now fills the available workspace and the Client / Kind / Specifics / Details stepper spans the full card width.
- If a client has exactly one Issue Family, it is selected automatically and the intake moves directly to Specifics.
- Client pages and client lists now use the term **Issue Families** and show the effective service model more clearly.
- Help & FAQ now explains the four-family architecture, Ticket vs SaaS Incident, Query, client-scoped family availability, support paths, transitions, parallel support, SLA behavior and role-specific actions.

## Upgrade

Copy the existing `.env`, then run:

```powershell
npm install
npm.cmd start
```

To preview the service-model provisioning:

```powershell
npm run provision:suntecsds-service-model
```

To apply after review:

```powershell
npm run provision:suntecsds-service-model -- --apply
```

The default target workspace is `suntecsds`.
