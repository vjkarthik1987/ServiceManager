# Service Manager v23.1.1 Release Notes

## Theme

Issue Families setup and administration cleanup.

## Added

- Idempotent UAT user setup script: `scripts/setup-suntec-users.mjs`
  - resolves an existing workspace and client
  - creates/updates the agreed UAT personas
  - preserves assignments to other clients
  - generates one-time passwords only for newly created users
  - dry-run by default
  - never creates an organization or client
- Idempotent Request taxonomy setup script: `scripts/setup-request-taxonomy.mjs`
  - Family: Request
  - Issue Types: Incident, Service Request, Maintenance Request, Problem, Change Request, Query
  - 38 agreed Subtypes across those Issue Types
  - optional assignment of Request Family to an existing client
  - never creates an organization/client/workflow/SLA/product/user
- Shared seed catalogue in `lib/v23.1.1-seed-catalogue.mjs`.

## Issue Families UI

- Removed release-version narration such as "v23.1 taxonomy" from the admin UI.
- Kept a single sidebar entry: `Issue Families`.
- `+ Family`, `+ Issue Type`, and `+ Subtype` stay on one horizontal toolbar on desktop.
- Reworked the hierarchy table to:
  - Name
  - Type
  - Parent
  - Configuration
  - Status
  - Actions
- Workflow / Form / Support Path / SLA are summarized with compact configuration badges instead of separate wide columns.
- Main table actions are simplified to `Configure` and `Edit` (Family retains `Open` and `Edit`).
- Form fields remain accessible from the Configure dialog.
- Family detail page uses the same hierarchy and configuration language.

## Deliberately not done

- no organization creation
- no client creation
- no automatic user/taxonomy setup on startup
- no workflow/SLA/product seeding
- no destructive migration
- no automatic changes to existing clients unless an explicit setup command targets them

## Validation

- JavaScript/MJS syntax checks: PASS
- Existing v23/v23.1 tests retained
- New v23.1.1 seed-catalogue tests added
- New v23.1.1 Issue Families UI source tests added
- Total automated tests at packaging time: 27 PASS / 0 FAIL
- Normal Incident guard retained
