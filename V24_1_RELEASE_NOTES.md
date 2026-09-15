# Service Desk v24.1.0 Release Notes

## Scope
v24.1 is a focused UAT bug-fix release on top of v24.0.0. It keeps the Incident taxonomy/support path intact while adding a smaller status-control treatment and configurable SLA clock-start behaviour.

## Fixes

### 1. RCA/lifecycle fields removed from Incident creation for all personas
Partner and SunTec Agent creation screens could still receive legacy issue-type custom fields such as RCA Category, Root Cause, Corrective Action, Preventive Action, RCA Status, release/test and approval fields.

v24.1 now filters Incident lifecycle fields server-side at creation for **Customer, Partner and Agent**. These fields remain lifecycle/post-creation information and can be shown later where the workflow requires them.

### 2. Components restored on all Incident intake forms
The v24 form definitions correctly included `COMPONENTS`, but the dynamic form renderer did not render the `service_context` dynamic-field group. As a result Components was absent for Customer, Partner and Agent.

v24.1 adds `service_context` to the renderer order, so the configured Components multiselect appears for all four Incident subtypes and all three creation personas.

## Compatibility
- No taxonomy change.
- No workflow change.
- No SLA change.
- No support-path change.
- No existing request migration required.
- Existing v24 `suntecgroup` configuration remains compatible.

### 3. Compact Change Status control
The large Available Actions / Actions control has been replaced by a small **Change status** button beside the current stage. Support-routing actions remain separate because routing and workflow state are independent concepts.

### 4. Configurable SLA clock start
SLA eligibility and SLA clock start are now separate configuration concepts. SLA policies support these start triggers: issue raised, severity selected, priority selected, received by L2, received by L3, or a specific workflow status. For customer-backed Incidents the recommended/default trigger is **Issue raised**. Once started, the original `startedAt` is preserved across support-level and classification changes.
