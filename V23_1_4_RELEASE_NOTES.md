# Service Manager v23.1.4 — Incident UAT Blocker Fix Pack 2

## Purpose

v23.1.4 fixes the blockers found while testing the real Danske client flow in v23.1.3. The release deliberately does not expand into new request families.

## Fixed

### Customer Incident intake
- Seeded v23.1 Incident taxonomy is recognized without depending only on historical `formDefinitionKey` / service-model binding metadata.
- Customer Incident creation hides Severity and lifecycle-only fields: Release ID/Type, S3 Bucket URL, Test Case Link, RCA Category, Root Cause, Corrective Action, Preventive Action, RCA Status, Approver and Exception Approver.
- The request service independently strips those fields for seeded v23.1 customer Incidents, so the protection is not UI-only.
- Existing UAT custom fields such as Incident Subtype and Remarks remain available.

### Client L1 ownership / routing
- Client/Bank L1 is treated as **organizational ownership**, not individual assignment.
- Customer users no longer need to assign or take ownership of the L1 stage before working it.
- A Client User whose assignment covers the request client can change the L1 status and route the request forward while `assignedTo` is empty.
- Moving a client-owned SaaS Incident to an `Assigned` workflow state no longer requires an individual L1 owner.
- Existing v23.1 Incident records without a stored service-model marker are recognized from taxonomy/support-path metadata and are backfilled on relevant actions.

### SaaS Incident seed metadata
The UAT support seed now writes explicit subtype markers:
- Application → `SAAS_INCIDENT_APPLICATION`
- Security → `SAAS_INCIDENT_SECURITY`
- Infrastructure → `SAAS_INCIDENT_INFRASTRUCTURE`
- Operational → `SAAS_INCIDENT_OPERATIONAL`

### Home
- Home follows the UAT reference more closely.
- `My work` and `Raise request` are grouped at the upper-right of the greeting area.
- Search remains the central element directly below the greeting.
- The duplicate Raise request button below Search has been removed.
- Metrics and Recent requests are more compact, with a one-screen desktop target.

## Retained from v23.1.3 / v23.1.2
- non-regressing SaaS support movements
- contextual workflow prerequisites
- prominent acknowledgement
- fixed left navigation / scrolling incident center / stable action rail
- business-calendar-aware SLA calculations
- SLA at-risk / breach logic and notification foundation
- Standard Bank Platinum / Danske Gold UAT support plans

## Upgrade

No destructive migration is required.

For an existing UAT database, run:

```bash
npm install
npm run seed:uat:support -- --workspace=suntecgroup --apply
npm run test:all
npm start
```

The support seed is idempotent.

## Validation

The packaged source is validated by the complete automated suite plus v23.1.4 regression tests. Live MongoDB/SMTP/browser UAT remains required on the target environment.
