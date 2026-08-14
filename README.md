# Service Desk v21

Service Desk v21 is the cloud-UAT release for the `suntec` workspace. It builds on the v20.2 Jira-style workbench and one-shot bootstrap, then adds client + Issue Family SLA assignment, engagement-manager portfolio access, a redesigned Filters experience, active-filter context on Requests, a substantially larger Help & FAQ guide, and a deterministic year of UAT request history.

## v21 highlights

- Sidebar request navigation is labelled **Requests**. Home-page actions say **See requests**.
- Requests has a prominent **Requests assigned to me** quick filter.
- Filters has a compact query builder, quick filters, one-line `Only me | My team | Everyone` visibility control, and a collapsed-by-default save section.
- When a query opens Requests from Filters, an **Active filter** banner remains above the table until cleared.
- SLA assignment is now client + Issue Family specific. Standard Bank Ticket → **Gold – Expedited SLA**; Danske Bank Incident → **Xelerate SaaS Sample Incident SLA**. Danske Service Request and Maintenance Request do not inherit the Incident SLA.
- Standard Bank + Retail/Corporate children remain Ticket-only with direct-to-L3 SunTec Operations routing and no customer operational task stage.
- Danske Bank + Retail/Corporate children use the documented SaaS Incident, Maintenance Request and Service Request model.
- Support UAT users include Deepesh, Nisha, Anitha, Subramoni, Jisha and separate Rajani Partner/L2 and SunTec/L3 identities.
- **Sudheer Padiyar** and **Madhu M** are Engagement Managers across both Standard Bank and Danske Bank portfolios, including children. Engagement Managers have portfolio visibility but are not L3 owner candidates by default.
- The bootstrap seeds **180 deterministic historical requests**: 30 each for Standard Bank, its two children, Danske Bank, and its two children, spanning the trailing year with varied families, statuses, modules, ownership and SLA health.
- Dashboard retains Today / This Week / This Month pulse, 30/90/180/365-day analytics, client/family/status distribution and SLA attention.
- Help & FAQ is expanded into a scenario-based product guide covering direct-to-L3, SaaS sequential/parallel support, ownership, returns, SLA, Filters and Engagement Manager usage.
- Browser favicon, Xelerate catalogue and role-aware workbench remain included.

See [`UPGRADE_TO_V21.md`](UPGRADE_TO_V21.md), [`docs/v21-release-notes.md`](docs/v21-release-notes.md), and [`docs/suntec-cloud-bootstrap.md`](docs/suntec-cloud-bootstrap.md).

## Cloud bootstrap

Preview first:

```bash
npm run bootstrap:suntec
```

Apply after reviewing the dry run:

```bash
npm run bootstrap:suntec -- --apply
```

The bootstrap is idempotent, targets the `suntec` workspace by default, and writes a JSON backup before applying changes. Newly created UAT users receive generated temporary passwords printed once in the terminal.

## Core orchestration retained

- Client + Level 2 subtype operational rules
- Optional severity and environment conditions
- Inheritance to child clients
- Independent workflows for L1, L2, and L3 stages
- Sequential and parallel support movement
- Simultaneous L2 + L3 execution
- Workflow-status task templates
- Automatically generated request tasks
- Blocking-task governance
- SLA, comments, attachments, mail, audit, filters, custom fields, and request lifecycle controls

The orchestration model is described in [`docs/workflow-orchestration-v19.4.md`](docs/workflow-orchestration-v19.4.md).

## v19.7 improvements

- Request status changes and support movements return without waiting for SMTP.
- Double submissions are blocked in the browser and duplicate current-status submissions are safe no-ops.
- Stale workflow/status and support-level forms return a clear refresh message.
- Browser comment validation now matches the service-side minimum length.
- SMTP timeouts and IPv4 preference are configurable.

See [`docs/v19.7-fixes.md`](docs/v19.7-fixes.md) for the detailed change list.

## v19.5 improvements

- Fixed administrator client search while raising a request.
- User access is context-aware: adding another client to a client user no longer defaults to agent access.
- Single-option dropdowns are selected automatically and shown as non-editable values.
- Client operational rules use readable responsive cards.
- SLA journey arrows appear above milestone cards.
- Request tasks now have a dedicated stage-based workspace with progress, blockers, open/completed grouping, update notes, and direct completion controls.
- Workflow status changes and support movement are both blocked until relevant blocking tasks are completed or cancelled.

See [`docs/v19.5-fixes.md`](docs/v19.5-fixes.md) for the detailed change list.

## Run

```bash
cp .env.example .env
npm install
npm run dev
```

Node.js 22 or later and MongoDB are required.

## Demo data

```bash
npm run seed:demo
npm run seed:demo -- --reset
```

Default demo administrator:

```text
tenant: sbs
email: demo.admin@suntecgroup.com
password: password
```

## Validation

- JavaScript syntax checks across the web app, services, models, and scripts
- EJS compilation across every template
- Workspace JSON validation
- API import/export consistency check
- ZIP integrity check

A live MongoDB-backed browser test is still recommended in the deployment environment.

## Xelerate incident workflow task importer

After creating the nine Xelerate incident workflows and their statuses, preview the standard task-template import:

```powershell
npm run configure:xelerate-tasks
```

Pilot one workflow and then apply it:

```powershell
npm run configure:xelerate-tasks -- --workflow="Application Incident – L1 Bank"
npm run configure:xelerate-tasks -- --workflow="Application Incident – L1 Bank" --apply
```

Apply all nine workflows after reviewing the dry run:

```powershell
npm run configure:xelerate-tasks -- --apply
```

See `docs/xelerate-workflow-task-importer.md` for safety behaviour and organization selection.

## v19.8.5 — client-scoped service models

v19.8.5 makes Issue Family availability client-specific and authoritative. Standard Bank is configured for the regular **Ticket** process, while a separate SaaS UAT hierarchy is configured for **Incident**, **Maintenance Request**, and **Service Request**. Request intake now skips the Kind click when only one family is available, uses the full workspace, and Help & FAQ documents the four-family operating model in detail.

See `UPGRADE_TO_V19.8.5.md` and `PROVISION_SUNTECSDS_SERVICE_MODEL.md`.

## v19.8.7 — profile-aware request workbench

v19.8.7 is built directly from v19.8.5 and adds a Jira-inspired request detail workspace, compact visual SLA, minimal task rows, sticky right action rail, profile-specific sidebars/accent schemes, and expanded help. See `docs/v19.8.7-release-notes.md`.

## v19.8.9 — Jira-style control tower + ownership + return routing

v19.8.9 keeps the v19.8.5 workflow foundation and evolves the v19.8.7 workbench into a denser Jira-style issue workspace. It adds stage-specific ownership, Take ownership / manager assignment, right-side status and task drawers, mandatory task completion notes, clearer customer-vs-internal status, laptop-friendly request queues, and configurable forward/return support movements. See `docs/v19.8.9-release-notes.md` and `UPGRADE_TO_V19.8.9.md`.

## v20 — comment stability + explicit self-assignment

v20 keeps the v19.8.9 Jira-style workbench and fixes the immediate comment-rendering mismatch. Newly posted comments now use the exact same layout as comments rendered after refresh, and the activity count updates instantly. Eligible owner selectors now put the signed-in user first as **Me**, while an owned stage shows **Me** prominently in the ownership rail. The request-list status/type/support/assigned-to-me colour cues are included. See `docs/v20-release-notes.md` and `UPGRADE_TO_V20.md`.

## v20.1 — reliable onboarding mail

v20.1 keeps the v20 workbench and makes registration/identity mail observable and retryable. Workspace activation and new-user invitation mail are awaited, SMTP retries automatically, pending activation can be resent, and active users have a **Send access email** recovery action. Optional `PUBLIC_BASE_URL` provides stable links in activation/reset/verification mail. See `docs/v20.1-release-notes.md` and `UPGRADE_TO_V20.1.md`.
