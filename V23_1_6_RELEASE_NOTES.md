# Service Manager v23.1.6 — UAT Comments + Intake Polish

## Scope
v23.1.6 is a focused UAT patch on top of v23.1.5. It does not change the support model, SLA catalogue, workflows, or support paths.

## Fixes

### Comments and internal-note privacy
- Internal-note author names are explicitly readable in the conversation timeline.
- Client users see only `client_visible` comments.
- Partner users see customer-visible comments and Partner + SunTec internal notes, but not SunTec-only notes.
- Partner users can explicitly choose **Reply to customer** or **Internal note** in the comment composer.
- New comment audit events carry their visibility classification.
- Client audit view filters Partner/SunTec-only and SunTec-only comment events, including legacy events whose message identifies them as internal.

### Request intake UX
- If a selected client has exactly one enabled Issue Family, it is auto-selected and omitted from the visible progress rail.
- Five-step request journeys now have a proper five-column layout instead of wrapping 3 + 2.
- On narrower screens, the progress rail stays horizontal and scrolls rather than collapsing into stacked rows.

### Customer-reported Severity
- Severity is restored to customer request intake when the configured request type supports it.
- On a SaaS Incident, the field is labelled **Reported severity** with guidance that Support may confirm/reclassify it during triage.
- Support-side post-create reclassification remains controlled by Agent/Partner/Admin permissions.
- Severity changes remain auditable and SLA recalculation keeps the original SLA start time.

## Compatibility
- No reseed is required.
- No destructive database migration is required.
- The timeline schema adds an optional visibility field to new timeline events. Existing timeline rows remain valid and are handled safely by the UI fallback filters.

## Validation
- Full automated regression suite: 71/71 passed.
- v23.1.6 focused tests: 7/7 passed.
- JavaScript/MJS syntax checks passed.
- EJS extracted-scriptlet syntax checks passed for 48 templates.
- v23 Normal Incident isolation guard passed.
