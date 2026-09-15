# Service Manager v23.0.1 — Clean Upgrade Release Notes

v23.0.1 keeps the v23 SaaS functionality and improves installation/provisioning safety.

## No change to the product boundary

Normal/non-SaaS Incident Management remains explicitly outside v23. SaaS behavior still requires an exact `SUNTEC_SAAS_V23` type binding.

## Cleaner upgrade changes

- Added `V23.ps1` as the single Windows entry point for preflight, dry-run, verify, test and explicit database apply.
- Added MongoDB preflight/discovery from project `.env` files and environment variables.
- Removed the silent fixed-database fallback from the provisioner.
- Provisioning is blocked if the resolved database has zero collections.
- Where Mongo permissions allow, preflight lists other databases with collections when the selected database is empty.
- Dry-run statistics are labeled `Would create` and `Would update`.
- Removed confusing package scripts that could look like a one-command database apply.
- Added database-discovery automated tests.
- Added a structured manual UAT checklist in Markdown and CSV.

## Core v23 capabilities retained

- Configurable SaaS field/form registry.
- SaaS Incident forms and workflow.
- Severity/priority permission and audit behavior.
- SLA target recalculation without resetting the original start.
- Support-level/status independence for SaaS requests.
- Generic, Access, DR/BCP and PITR Service Request workflows.
- Change, Problem and Maintenance workflow definitions.
- Approval, visibility and product/version foundations.
