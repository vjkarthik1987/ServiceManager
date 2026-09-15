# Upgrade to Service Manager v25.0.0

## 1. Install / validate code

```bash
npm install
npm run validate:v24
npm run test:v25
npm run test:all
```

## 2. Back up the database

Use your normal production/UAT database backup process before applying configuration migrations. The migration script also creates its own JSON backup in apply mode, but it should not replace a database-level backup.

## 3. Dry-run the v25 workflow migration

```bash
npm run migrate:v25:dry
```

Review the output before applying.

## 4. Apply v25 configuration

```bash
npm run migrate:v25
```

This upserts the v25 Incident, Problem, Change Request and Maintenance Request workflow configuration and preserves older workflow documents for history/rollback.

## 5. Decide whether to refresh existing open UAT requests

New requests use the migrated v25 configuration. Existing requests keep their embedded workflow snapshot until synced.

```bash
npm run sync:v25:dry
```

If the proposed request set is correct:

```bash
npm run sync:v25
```

## 6. Smoke test

Create fresh Incident, Change Request, Problem and Maintenance Request records and verify the expected role-specific transitions, approval paths, mandatory transition fields and audit entries.

Service Request remains unchanged in this release.
