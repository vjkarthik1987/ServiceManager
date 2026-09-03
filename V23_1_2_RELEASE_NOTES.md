# Service Manager v23.1.2 — UAT Readiness

Release date: 03 September 2026

v23.1.2 is intentionally a correctness-and-simplification patch before structured UAT. It does not introduce a new routing model; Support Paths remain the routing backbone.

## 1. SLA correctness

- Added a client business-calendar model with timezone, working weekdays, business-day start/end and holiday exclusions.
- Child clients can inherit the parent calendar or define their own calendar.
- SLA calculations now distinguish elapsed `minutes/hours/days` from `business_hours/business_days`.
- Working-time calculations skip weekends, configured holidays and out-of-hours periods.
- Timezone conversion uses IANA zones and is tested across the Europe/Copenhagen DST boundary.
- UAT master-data provisioning configures Standard Bank for `Africa/Johannesburg` and Danske Bank for `Europe/Copenhagen`.
- Gold/Platinum 24x7 severity targets continue to use elapsed time rather than business time.

## 2. SLA notification behaviour

- Added a request-service candidate endpoint used by the web gateway's background notifier.
- `SLA At Risk` is raised once when the active SLA target reaches 75% consumption.
- `SLA Breached` is raised once after the active target is breached.
- Timeline markers/idempotent candidate claims prevent repeat mail on each poll cycle.
- The notifier bootstraps for the latest active organization at web startup and continues on a one-minute polling cadence.

## 3. General notifications

Notification recipient selection was tightened so that internal activity does not automatically leak to customers. Customer-visible lifecycle changes, information requests, information supplied, assignment/support movement and SLA events remain notifyable. Internal/partner comments remain internal unless explicitly customer-visible.

## 4. SaaS Incident task cleanup

Normal status progression no longer needs a generic task at every state. Runtime task generation and UAT Incident workflow seeding retain only separately accountable work such as:

- verification/evidence,
- development and release/deployment,
- testing,
- vendor coordination,
- RCA/corrective/preventive action,
- closure approval.

Generic `Accept ownership`, `Perform analysis`, `Record hold reason` and similar workflow chores are not generated for the v23 SaaS Incident flow.

## 5. Customer UX

- Query/Service Request pages do not display an empty/non-applicable SLA card.
- SaaS customer views suppress internal workflow/open-task clutter.
- Legacy ownership and return controls are suppressed in the SaaS flow.
- Customer request creation does not persist `raisedOnBehalfOf` data.
- Customer lifecycle actions remain contextual (for example information supply and verification/closure actions).

## 6. Agent UX

- SaaS first-action ownership can claim an unassigned eligible stage automatically.
- Legacy SaaS ownership/return controls are suppressed where they duplicate the Support Path/status model.
- Generic Tasks/My Tasks/Team Tasks sidebar entries are removed for operational personas; accountable tasks remain accessible contextually on the request.

## 7. Simplified Incident intake

The v23 SaaS Incident create form hides lifecycle fields that should only appear later, including severity/priority at customer intake and release/RCA/test/approval data. The request service also strips these fields server-side if a client submits them manually.

## 8. First-impression UX

- `/` renders a calm landing/sign-in page after installation instead of redirecting an initialized system back to `/setup`.
- `/setup` remains the first-install path and redirects back to `/` for an initialized workspace unless forced.
- Post-login Home is minimalist and search-led while retaining open, attention, SLA-risk, customer-waiting and recent-work information.
- Successful login passes through a subtle `Setting up your workspace…` transition and resolves a client-aware workspace label where possible.

## 9. Bundled UAT data

Three idempotent provisioning scripts are included:

1. `scripts/seed-uat-master-data.mjs`
2. `scripts/seed-uat-users-slas.mjs`
3. `scripts/seed-uat-support-model.mjs`

The support-model script uses Standard Bank = Platinum and Danske Bank = Gold as UAT defaults only. These are configurable command-line choices, not assertions about live customer contracts.

## 10. Verification

The release includes v23.1.2 regression tests for:

- Friday-to-Monday business-hour carry-over,
- configured holidays,
- business-day duration,
- Copenhagen DST,
- 75% SLA consumption,
- 24x7 elapsed-time targets,
- landing/home/login transition,
- business-calendar configuration,
- server-side Incident lifecycle-field protection,
- task-clutter cleanup,
- SLA notification candidate wiring.
