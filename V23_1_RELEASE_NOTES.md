# Service Manager v23.1.0 Release Notes

## Theme

Three-Level Taxonomy Foundation.

## Added / changed

- Family → Issue Type → Subtype taxonomy levels
- Level-3 Subtype model support in the existing taxonomy collection
- Admin creation/editing for Families, Issue Types and Subtypes
- Three-level taxonomy tree and detail screens
- Client Family enablement via `enabledFamilyIds`
- Three-level request intake
- Family / Issue Type / Subtype snapshots on requests
- Workflow and support-path resolution at Issue Type/Subtype level
- SLA applicability/policy references at Issue Type/Subtype level
- Form, approval and notification policy references at Issue Type/Subtype level
- Subtype override + parent Issue Type inheritance behavior
- v23.1 taxonomy unit tests

## Not part of v23.1

- no SunTecSDS bootstrap
- no organization/client creation
- no user/persona seeding
- no catalogue seeding
- no automatic Family assignment
- no automatic old-taxonomy conversion or destructive migration

## Validation

- JavaScript/MJS syntax checks: PASS
- v23/v23.1 automated suite: 19 PASS / 0 FAIL
- normal Incident guard retained
