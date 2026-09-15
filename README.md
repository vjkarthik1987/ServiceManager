# Service Manager v25.0.0

**v25.0.0 — live Jira workflow rebuild** is the current Service Manager UAT codebase.

The workflow authority for this release is the live Jira REST export captured from SunTec Jira on 14 Sep 2026. The previous PPT-derived workflow interpretation is retained only as historical documentation.

## Rebuilt in v25

- Incident: exact Jira status graph, L1/L2/L3 paths, transition identity, conditions, validators, required transition fields, screens, portal metadata, return-state rules and global escalation actions.
- Change Request: exact Jira graph including Bank approval, Management approval, Product/Custom and Requirement Grooming branches, development, test and deployment paths.
- Problem Management: exact Jira graph including Review, Investigate, Pending, Complete, Cancel, Close and return transitions.
- Maintenance Request: exact Jira graph including approvals, Snapshot Revert, DR switching, reverse sync, switchback, BCP, VA/PT, Incident/Problem and Service Request branches.
- Service Request: intentionally deferred to a later release.

## Source of truth

The four immutable source snapshots are stored in:

```text
config/v24-saas/jira-source/
  incident.full.json
  change.full.json
  problem.full.json
  maintenance.full.json
```

The generated Service Manager workflow configuration is in `config/v24-saas/workflows.json`.

## Validate

```bash
npm run validate:v24
npm run test:v25
npm run test:all
```

Expected result for this packaged build: **128/128 tests passing**.

## Existing SunTecGroup UAT database

Always dry-run first:

```bash
npm run migrate:v25:dry
```

Apply after reviewing the plan and backup path:

```bash
npm run migrate:v25
```

Existing open requests retain embedded workflow snapshots until explicitly refreshed. Dry-run the request sync first:

```bash
npm run sync:v25:dry
```

Then apply if the UAT tickets should move to the v25 workflow definitions:

```bash
npm run sync:v25
```

The configuration migration and open-request sync are intentionally separate. Apply-mode scripts create backups and do not delete historical workflow configuration.

See `V25_RELEASE_NOTES.md`, `V25_WORKFLOW_SOURCE_MAP.md`, `V25_BUILD_VALIDATION.txt`, and `UPGRADE_TO_V25.md`.
