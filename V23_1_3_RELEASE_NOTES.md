# Service Manager v23.1.3 — Incident UAT Fix Pack 1

## Release intent

v23.1.3 is a focused correction release based on the first Standard Bank / Danske Bank Incident UAT cycle. It does not add a new service-management feature family. It fixes correctness and interaction issues exposed while testing the v23.1.2 SaaS Incident model.

## Fixed

### Customer Incident intake

- Customer SaaS Incident creation no longer asks the customer to classify Severity.
- Customer creation no longer renders post-creation lifecycle fields including Release ID/Type, S3 artifact URL, Test Case Link, RCA fields, Corrective/Preventive Action, RCA Status, Approver and Exception Approver.
- The web layer filters these definitions before rendering.
- The request service strips the same fields from client SaaS Incident payloads, including generic `customFieldValues`, so the boundary is not UI-only.
- Existing v23.1.2 requests can be recognized as SaaS requests from configured taxonomy even when the historical record did not persist `serviceModelKey`.
- New requests persist `serviceModelKey` explicitly.

### Customer ownership UX

- Customer users cannot Assign or Take Ownership of support stages.
- Server-side stage assignment rejects customer assignment/ownership attempts.
- Customer pages remain focused on information, verification and resolution actions.

### Support-level status regression

- Moving a started SaaS Incident between L1/L2/L3 no longer initializes the receiving stage back at `New` when equivalent progress can be preserved.
- If an exact target workflow status is unavailable, support movement chooses the closest suitable non-start working state (`Analysis`, `Assigned`, `Under Review`, `In Progress`) rather than regressing the incident.
- Status-change API also rejects moving a started SaaS Incident back to a start/New status.
- Existing v23.1.2 records receive the SaaS marker opportunistically when a v23 support/status action is performed.

### Workflow prerequisites instead of blocking-task clutter

- Generic Workflow Tasks/Open Tasks presentation is suppressed for SaaS Incident detail pages.
- Genuine blocking requirements are presented contextually inside the status-change drawer.
- A support user can enter the required completion note/evidence and complete the blocker as part of the same transition attempt.
- The underlying task remains available for audit history; users are not asked to manage generic blocking-task mechanics as a separate workflow.

### Acknowledgement / response SLA

- Acknowledge Incident is promoted to a prominent top action in the support action rail while the response milestone is running, at risk or breached and not yet acknowledged.
- S1/S2 acknowledgement is visually emphasized.
- Acknowledgement can be performed by an eligible actor on any active support stage, including parallel Application support paths, rather than only the primary stage.
- The existing response-SLA milestone records the acknowledgement actual and the existing notification/audit path remains in use.

### Incident workbench layout

- Desktop request detail is constrained to the viewport.
- Left navigation stays stable.
- The central issue content is the primary scrolling surface.
- The right action rail stays stable instead of travelling with the whole document; it scrolls internally only when the viewport genuinely cannot fit its controls.
- Mobile/smaller layouts return to normal document scrolling.

### Issue Profile cleanup

- Customer SaaS Incident Issue Profile hides internal lifecycle custom fields.
- Additional fields render as structured label/value rows with spacing and dividers instead of concatenated text such as `Incident SubtypeUI Functional Issue`.
- The Type row now shows Family / Issue Type / Subtype.

### Home / launchpad

- Post-login Home is intentionally compact and one-screen-oriented on normal desktop/laptop viewports.
- Search remains the dominant element.
- Primary action (for example Raise Request) is smaller and right-aligned directly below the search area.
- Quiet operational metrics and a short Recent section remain without turning Home into a reporting dashboard.

### Open Escalations

- Routine `support_level_changed` / parallel support-path movement no longer makes a request an escalation.
- Open Escalations is based on real SLA breach or explicit escalation events.

### Agent action cleanup carried forward

- v23 SaaS intake suppresses the legacy Trigger selector.
- Partner Note / Return Request remain hidden where the v23 SaaS model does not use them.
- Generic My Tasks/Team Tasks navigation is not exposed to operational personas.

## Retained from v23.1.2

- Standard Bank / Danske Bank UAT hierarchy and personas.
- Silver / Gold / Platinum SunTec SLA policies.
- Standard Bank Platinum and Danske Bank Gold UAT plan assignments.
- Johannesburg/Copenhagen timezone-aware business calendars, weekend/holiday handling and Copenhagen DST behavior.
- 75% SLA At Risk and breach notification candidate logic.
- General customer/support notification behavior.
- Application parallel L2 + L3 Support Path and Security/Infrastructure/Operational support paths.
- Minimal `/` landing page and login workspace transition.

## Deliberately not part of v23.1.3

The following remain later work and were not silently added to this correction release:

- Service Request / Maintenance Request approval framework.
- Post-creation visibility expansion from L3 to L2/L1.
- Product-version LOV from TBMS 4.1 onward.
- Internal OLA framework for Development / Platform / Release / Testing.
- Production Jira project/status mapping.
- Person-level routing/assignment rules.

## Validation

- `npm run test:all`: **51 passed / 0 failed**.
- `npm run verify:v23-guard`: passed.
- `node --check` passed for modified web and request-service runtime files.
- Extracted EJS scriptlet syntax validation: **48 templates / 0 failures**.

## Upgrade note

No destructive database migration is required for the v23.1.3 UI/runtime corrections. New v23 requests persist `serviceModelKey`; historical v23.1.2 requests are recognized from the configured SaaS taxonomy and are backfilled during relevant support/status actions.
