# Service Manager v24.2.1

## Purpose

v24.2.1 is a focused bug-fix/configuration release on top of v24.2.0. It fixes request editing in the client workspace, makes SLA-notifier startup resilient to the normal multi-service startup race, and completes Maintenance Request configuration and controlled SunTecGroup migration support.

## Fix: request Edit action

The request page rendered an **Edit** button for clients, but the corresponding `editRequestModal` was only rendered for non-client portals. The button therefore had no dialog to open in the customer workspace.

v24.2.1 renders the edit dialog for every non-terminal request and continues to enforce field permissions:

- Customer: may edit relevant customer-facing fields including Summary, Description, Severity, Product, Environment, Modules and permitted custom fields.
- Customer: **Priority remains hidden and cannot be edited or viewed.**
- Partner/Agent: may edit Priority and other support-visible fields permitted by the existing request service.
- Internal Incident lifecycle fields remain filtered from inappropriate creation/edit contexts.
- Existing server-side audit and validation behavior is retained.

## Fix: SLA notifier startup race

When `npm run dev` starts all services concurrently, the web process can become ready before the organization/request services. The notifier bootstrap previously performed an immediate fetch and printed an `ECONNREFUSED` stack during this normal race.

v24.2.1 retries notifier bootstrap with bounded exponential backoff (up to six attempts). This does not suppress a persistent failure: a concise error is logged after the retry budget is exhausted.

## Maintenance Request configuration

The supplied Maintenance Request JSM workflow has been represented as the common `WF_SAAS_MAINTENANCE` workflow and is now fully wired into the v24 runtime configuration/migration path.

Configured Maintenance Request subtypes:

1. Scheduled Maintenance
2. Proactive Maintenance
3. Emergency Maintenance
4. Vulnerability Run
5. Penetration Test Run
6. Actual DR

All six use the common Maintenance workflow at Issue Type level. Existing subtype-specific support paths (for example DevOps, Security Operations or DR Operations) are preserved rather than overwritten.

### Maintenance form configuration

Scheduled / Proactive / Emergency Maintenance include configurable fields for release request type, Release ID, Components, purpose, test evidence, duration, due date and approval/evidence fields.

Vulnerability and Penetration Test forms include scan/test activity, components scanned, scan date, due date and approval/evidence fields.

Actual DR includes DR location, initiation date, reason, switchover time, closure date and approval fields.

Client Priority remains hidden because Priority is support-side classification across the service model.

## Maintenance SLA

Maintenance Request does **not** inherit the Incident SLA. The migration explicitly sets the Maintenance Request Issue Type to SLA not applicable and clears any direct Incident-style SLA policy reference. Existing subtype support paths are preserved.

## SunTecGroup migration

Use:

```powershell
node scripts/migrate-suntecgroup-to-v24.2.1.mjs --workspace=suntecgroup --dry-run
```

Review the output, then apply:

```powershell
node scripts/migrate-suntecgroup-to-v24.2.1.mjs --workspace=suntecgroup --apply
```

The migration:

- keeps a JSON backup before writes;
- updates Incident, Problem and Change Request configuration from the v24 model;
- upserts/binds the Maintenance Request workflow;
- assigns six Maintenance subtype forms;
- provisions the v24 runtime config documents and exact Maintenance subtype bindings;
- keeps Maintenance SLA disabled;
- preserves existing subtype-specific Maintenance support paths;
- does not rewrite existing request history, comments or audit records.

## Validation

Final automated regression run:

```text
115 tests
115 passed
0 failed
```

Additional checks:

- v24 configuration validation: PASS
- JavaScript/MJS syntax checks for changed runtime/migration/provisioning files: PASS
- v24.2.1 focused tests: 7/7 PASS
- configuration totals: 47 fields, 22 forms, 8 workflows, 1 common v24 support path, 22 subtype bindings
