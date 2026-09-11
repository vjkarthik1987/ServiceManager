# Service Manager v24.2.0 — Release Notes

## Purpose
v24.2.0 is a UAT-focused refinement of the v24 Incident model and adds controlled provisioning for Problem and Change Request workflows.

## User experience
- Change Status shows the action label only; redundant labels such as `Resolution → Resolution` are removed.
- Request intake progress is dynamic: it is hidden before client selection and automatically omits taxonomy steps where only one choice exists.
- The Requests search control spans the request grid width.
- Request keys are protected from truncation on smaller screens; the table can scroll horizontally where required.
- Request statuses are rendered as semantic pills, including a distinct Closed state.
- Technical workflow names such as `SaaS Incident v24 - JSM Aligned` are not shown to operational users.
- Severity is presented using S1/S2/S3/S4 labels.

## Field behaviour and editing
- Customer users can view and edit relevant request fields, including Severity.
- Priority remains support-side: customers do not see it and cannot edit it.
- Partner and Agent users retain support-side Priority controls.
- Request edits are auditable.
- Lifecycle-only fields remain excluded from initial Incident intake.
- Components is available through configurable master data/form configuration.

## Visibility
- A customer-raised S1 Incident currently active at L2 can be surfaced in the L3 workspace for awareness without changing its support level, assignment, or workflow state.

## Notifications
- Adds client-level notification policy support for core request events such as creation, edit, status change, closure and comments, with organization defaults/fallback behaviour.
- Internal-note visibility remains separate from customer-visible comment notifications.

## Workflow/configuration provisioning
- The v24.2 SunTecGroup migration script can provision/update:
  - Incident v24 configuration changes.
  - Components configuration.
  - Problem workflow.
  - Change Request workflow.
  - S1-at-L2 visibility behaviour for L3.
  - Client notification defaults/configuration support.
- Existing requests/history are not bulk-rewritten by the migration.
- Existing legacy workflow/path records are preserved unless explicitly handled by the migration.

## Development terminology
`Development` remains a stage within the Incident workflow. v24.2 does not create a separate linked engineering/development-work-item workflow.

## Compatibility and regression
- Full regression suite: 108/108 passed.
- v24 configuration validation: PASS.
- JavaScript/MJS syntax validation: PASS.
- JSON configuration parse validation: PASS.

## Deployment note
Run the migration in dry-run mode first and review its plan before applying it to `suntecgroup`.
