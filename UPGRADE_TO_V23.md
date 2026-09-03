# Upgrade to Service Manager v23.0.1 — Clean Procedure

## 1. Run from the application root

Place/extract `Service_Manager_v23_Clean_Upgrade` inside or beside the current Service Manager source tree. Open PowerShell in the application root — the folder containing `package.json`.

If the clean pack is inside the root:

```powershell
node .\Service_Manager_v23_Clean_Upgrade\apply-v23-clean.mjs
```

The installer accepts v21, v22 or an already-patched v23.0.0 tree. v21/v22 is upgraded through the validated v23 base layer first; an existing v23 tree receives the clean tooling/safety refresh.

## 2. Verify version

```powershell
node -p "require('./package.json').version"
```

Expected: `23.0.1`.

## 3. Database preflight — mandatory

```powershell
.\V23.ps1 preflight
```

This performs no database writes. It discovers MongoDB from `V23_MONGO_URI`, standard Mongo environment variables, or project `.env*` files.

If the selected DB is empty, preflight blocks. Do not continue until the real application DB is selected.

Example temporary override:

```powershell
$env:V23_MONGO_URI = "mongodb://127.0.0.1:27017/<real_database>"
.\V23.ps1 preflight
```

## 4. Dry-run catalogue binding

```powershell
.\V23.ps1 dry-run
```

The dry-run never writes. Review every ambiguous `[collection:id]` row. A display name such as `Application Incident` is not sufficient proof that a row is SaaS.

## 5. Automated safety verification

```powershell
.\V23.ps1 verify
```

This must pass before database apply.

## 6. Apply reviewed SaaS type bindings only

```powershell
.\V23.ps1 apply-db -ApproveBindings "collection:id,collection:id"
```

There is no name-based bulk-approval switch. Normal/non-SaaS Incident Management is deliberately protected from v23 inference.

To migrate existing open SaaS requests only after catalogue validation:

```powershell
.\V23.ps1 apply-db -ApproveBindings "collection:id,collection:id" -MigrateOpenSaasRequests
```

## 7. Manual UAT

Use `V23_UAT_CHECKLIST.md` or `V23_UAT_CHECKLIST.csv`. Every P0 failure blocks release.
