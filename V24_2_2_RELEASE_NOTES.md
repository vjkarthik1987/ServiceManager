# Service Manager v24.2.2

**Release focus:** JSM workflow alignment from the supplied Incident, Problem, CR Workflow and Maintenance Request reference decks.

## Why this release exists

v24.2.1 fixed request editing. v24.2.2 corrects the workflow model so the actions shown in Service Manager follow the source JSM workflows instead of exposing only a simplified subset.

The most visible UAT correction is on the customer Incident page. A customer-created Incident now follows:

`New -> Analysis`

From **Analysis**, the JSM-style Change status menu exposes the documented customer actions:

- Request to L2 Support -> L2 Support
- Deferred -> Deferred
- Duplicate -> Duplicate
- Not an issue -> Not an issue
- Send to Preproduction -> In Preproduction
- Close -> Closed
- On Hold -> On Hold
- Under Monitoring -> Under Monitoring

### Deliberate rule clarified during UAT

The supplied JSM reference shows Request to L2 Support as technically available from New as well as Analysis/In Preproduction/Test Failed. For Service Manager, the agreed customer rule is stricter: **New must enter Analysis before a customer can request L2 support.** Internal support assignment remains a separate guarded operation.

## Incident workflow

The Incident workflow is aligned across L1/customer, L2 and L3 paths, including:

- New -> Analysis
- controlled L2 and L3 routing
- L2 Support -> L2 Analysis and L3 Support -> L3 Analysis
- Analysis branches for Deferred, Duplicate, Not an issue, Preproduction, Closed, On Hold and Under Monitoring
- return paths from Deferred/On Hold/Under Monitoring to Analysis, L2 Analysis, L3 Analysis and Interim Resolution where present in JSM
- L2 Interim Resolution and Bank to Verify paths
- L3 Bank to Verify, Vendor Ticket Raised, Development and Resolve paths
- Release -> Build/Quality/Stage/Preproduction shortcuts
- Resolved -> Build/Quality/Stage/Preproduction shortcuts
- Verification Complete, Verify & Resolve, Test Failed, L2 Test Failed and L3 Analysis failure paths
- Problem Created and closure paths
- status-preserving management escalation actions

The customer UI no longer removes Request to L2 Support merely because it changes support level. Selecting it from Change status is translated into the existing guarded support-move operation, preserving the support path, audit and notification logic.

## Problem workflow

Problem Management now follows the supplied seven-state graph with 14 transitions:

- Open -> Under Review
- Under Review/Pending -> Under Investigation
- Under Review/Under Investigation -> Pending
- Pending -> Under Review
- Open/Under Investigation -> Completed
- Completed -> Under Investigation
- Open/Under Review/Under Investigation -> Canceled
- Canceled/Completed -> Closed

## Change Request workflow

The Change Request workflow now follows the supplied approval and delivery graph, including:

- New -> Analysis
- Analysis outcomes: Deferred, Duplicate, Not a Change, Requirement Analysis
- Product/Custom classification and corresponding grooming branches
- CR Form -> Approval by Bank
- Requirement Grooming -> Approval by Bank or Management Approval
- Management Approval -> Management Approved or back to Requirement Analysis on rejection
- Management Approved -> Approval by Bank (not directly to Development)
- Approval by Bank -> Approved or back to Requirement Analysis
- Approved -> Development -> Release
- Build/Quality/Stage/Preproduction test-pass chain and shortcut routes
- Verification/test-failure paths
- Test Failed -> Development re-analysis or Incident Created
- Verification Complete and Incident Created closure paths

## Maintenance Request workflow

Maintenance Request now follows the supplied approval, DR/switchback and report lifecycle, including:

- New -> Analysis -> Approved/Rejected
- Rejected -> New reopening
- cancellation paths
- Snapshot Revert approval/completion
- DR switch, reverse sync to primary, primary pre-check, primary switchback and reverse sync to DR
- BCP report preparation/publication
- VA/PT report paths
- Incident, Problem and Service Request detours only from the source statuses documented in the JSM deck, with corresponding return paths
- closure paths from Completed, published reports and linked Problem state

## Safe migration scripts

### 1. Configuration migration

Dry run by default:

```bash
node scripts/migrate-suntecgroup-to-v24.2.2-workflows.mjs --workspace=suntecgroup
```

Apply after reviewing the dry run:

```bash
node scripts/migrate-suntecgroup-to-v24.2.2-workflows.mjs --workspace=suntecgroup --apply
```

This upserts the v24.2.2 workflows/support path and preserves older configuration for rollback/history. It does not rewrite existing requests.

### 2. Existing open-request workflow snapshot refresh

Dry run:

```bash
node scripts/sync-open-requests-to-v24.2.2-workflows.mjs --workspace=suntecgroup
```

Apply after reviewing the candidate/skipped list:

```bash
node scripts/sync-open-requests-to-v24.2.2-workflows.mjs --workspace=suntecgroup --apply
```

This script creates a JSON backup and refreshes only workflow/support-path snapshots and status metadata. It preserves comments, attachments, timeline, tasks, ownership, SLA clocks, severity, priority, client/requester and request numbers.

## Validation

Validated on Node.js 22 with:

```bash
npm run test:v24.2.2
npm run validate:v24
npm run test:all
```

Result at packaging time: **128/128 automated tests passed** and **v24 configuration validation passed**.
