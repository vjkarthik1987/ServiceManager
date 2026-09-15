# Service Manager v24.2.3 — PPT-faithful workflow correction

## Why this release exists

v24.2.2 was not sufficiently faithful to the supplied JSM workflow decks. It simplified several transitions and, more importantly, mixed two different concepts:

1. Jira/JSM **portal customer transition visibility**; and
2. Service Manager **Bank/L1 operational-user permission**.

That caused valid Bank-side actions to disappear from the Change status menu and also allowed the workflow model to drift from the source transition definitions.

v24.2.3 corrects that model and keeps the source transition identity throughout the UI, web gateway, request service, stored workflow configuration and existing-request snapshots.

## Source decks

- `Incident(4).pptx` → `WF_SAAS_INCIDENT`
- `Problem(3).pptx` → `WF_SAAS_PROBLEM`
- `CR Workflow(3).pptx` → `WF_SAAS_CHANGE`
- `Maintenance Request(1).pptx` → `WF_SAAS_MAINTENANCE`

## Incident corrections

### Agreed Bank/L1 opening flow

The normal Bank-side Incident progression is:

`New → Analysis`

A Bank/L1 user cannot jump directly from `New` to `L2 Support`.

From **Analysis**, the Change status action list is deliberately ordered as:

1. Request to L2 Support → L2 Support
2. Deferred → Deferred
3. Duplicate → Duplicate
4. Not an issue → Not an issue
5. Send to Preproduction → In Preproduction
6. Close → Closed
7. On Hold → On Hold
8. Under Monitoring → Under Monitoring

This is the explicit UAT/product rule. The JSM transition detail for `Request to L2 Support` also lists New as a technical source, but Service Manager intentionally suppresses that New→L2 shortcut.

### Exact JSM transition identity

The workflow retains the Jira transition IDs and action labels from the deck. This matters because JSM contains multiple actions with the same source and target, for example:

- In Preproduction → Verification complete
  - `11` Deploy to Production/DR
  - `431` L2 Deploy to Production/DR
  - `511` Send to Production/DR
- Verification complete → Verify and Resolve
  - `351` Verify & Resolve
  - `521` Verify and Resolve

v24.2.3 submits a `transitionKey` so these actions are no longer collapsed into one ambiguous source→target pair.

### Jira portal visibility is separate from Bank/L1 permission

The source deck can mark a JSM transition as unavailable to Jira portal customers while it is still a valid operational action in the supplied Bank-side workflow menu. v24.2.3 stores both:

- `jiraCustomerEnabled` — source JSM portal metadata
- `clientEnabled` — Service Manager Bank/L1 operational permission

For the agreed Bank/L1 Analysis menu, `On Hold` and `Under Monitoring` are exposed even though their JSM portal-customer toggle is off in the transition detail screenshots.

### No invented Assign-to-L2 path

The previous v24.2.2 model contained a separate `Assign to L2` transition/routing rule from New. That was not part of the agreed Bank flow and has been removed.

The guarded support movement used by `Request to L2 Support` remains, but the user selects it through the normal Change status action menu.

## Problem, Change Request and Maintenance Request

The supplied source graphs remain configured and are carried forward as v24.2.3:

- Problem: 7 statuses / 14 transitions
- Change Request: 29 statuses / 53 transitions
- Maintenance Request: 24 statuses / 67 transitions

See `V24_2_3_WORKFLOW_SOURCE_MAP.md` for the source/config mapping and the complete Incident transition table.

## Existing open requests

Service Manager stores workflow snapshots on requests. Deploying code/config alone therefore does **not** guarantee that an already-created UAT request immediately uses the new workflow snapshot.

Use the two controlled scripts in order:

```bash
npm run migrate:v24.2.3:dry
npm run migrate:v24.2.3
npm run sync:v24.2.3:dry
npm run sync:v24.2.3
```

Both operations are dry-run first. The apply modes create backups. The request sync preserves comments, attachments, timeline, tasks, ownership, SLA clocks, severity, priority, client/requester and request numbers.

## Validation

Run:

```bash
npm run test:v24.2.3
npm run validate:v24
npm run test:all
```

See `V24_2_3_BUILD_VALIDATION.txt` for the packaged validation result.
