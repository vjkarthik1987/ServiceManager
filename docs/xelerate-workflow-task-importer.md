# Xelerate workflow task importer

This importer adds or updates the standard task templates for the nine Xelerate incident workflows without changing workflow statuses, transitions, support paths, client rules, SLAs, users, or existing request task instances.

## Safety behaviour

- Dry-run is the default.
- `--apply` is required to write changes.
- All selected workflows and statuses are validated before any write.
- Existing tasks are matched first by stable `localId`, then by normalized title.
- A manually created task with the same title is adopted and updated instead of duplicated.
- Unrelated manual tasks are preserved.
- A JSON backup of the affected workflow documents is written under `backups/workflow-task-imports/` before applying.
- Running the importer again is idempotent.

## Commands

Preview all nine workflows:

```powershell
npm run configure:xelerate-tasks
```

Pilot one workflow:

```powershell
npm run configure:xelerate-tasks -- --workflow="Application Incident – L1 Bank"
npm run configure:xelerate-tasks -- --workflow="Application Incident – L1 Bank" --apply
```

Apply all workflows:

```powershell
npm run configure:xelerate-tasks -- --apply
```

When more than one active organization exists, specify the organization short code, workspace slug, name, or MongoDB ID:

```powershell
npm run configure:xelerate-tasks -- --organization=SBS --apply
```

## Important

The importer changes reusable workflow task templates only. Existing requests already sitting in a status are not backfilled. The new tasks are instantiated when a request stage subsequently enters the configured status.
