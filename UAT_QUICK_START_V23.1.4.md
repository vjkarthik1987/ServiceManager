# v23.1.4 UAT Quick Start

## 1. Install and validate

```bash
cp .env.example .env
npm install
npm run test:all
npm run verify:v23-guard
```

If upgrading an existing v23.1.2 installation, preserve the existing `.env` / MongoDB URI rather than replacing it with the sample database name.

## 2. UAT data

The three seed scripts remain idempotent. For a fresh UAT database, run in this order:

```bash
npm run seed:uat:master -- --workspace=suntecgroup --apply
npm run seed:uat:users-slas -- --workspace=suntecgroup --apply
npm run seed:uat:support -- --workspace=suntecgroup --apply
```

For an existing database that already contains the UAT setup, rerunning them is safe when you need to reconcile the seeded configuration.

## 3. Useful UAT logins

All seeded UAT passwords are:

```text
password
```

### Danske Bank

| Persona | Login |
|---|---|
| Customer | `tinak@suntecgroup.com` |
| L2 Partner | `rajanir@suntecsbs.com` |
| L3 SunTec | `rajanir@suntecgroup.com` |
| Agent Manager | `jisha@suntecgroup.com` |

Danske Bank uses **Gold** in the seeded UAT model.

### Standard Bank

| Persona | Login |
|---|---|
| Customer | `karthikvj@suntecsbs.com` |
| Agent Manager | `deepeshc@suntecgroup.com` |
| L3 | `nishar@suntecgroup.com` |
| L3 | `anithakp@suntecgroup.com` |
| L3 | `subramonia@suntecgroup.com` |

Standard Bank uses **Platinum** in the seeded UAT model.

## 4. v23.1.4 focused smoke test

### A. Customer creation

Sign in as Tina and raise:

```text
Family: Request
Issue Type: Incident
Subtype: Application
Product: Xelerate
Module: Pricing
Environment: Production
```

Confirm:

- Severity is not requested from the customer.
- RCA / Root Cause / Corrective Action / Preventive Action are absent.
- Release ID / Release Type / Test Case Link / S3 URL are absent.
- Approver / Exception Approver are absent.
- Customer has no Assign / Take Ownership controls.

### B. Support classification / acknowledgement

Sign in as the appropriate support persona, set Severity and confirm that **Acknowledge Incident** is prominent while response acknowledgement is outstanding.

Acknowledge and confirm the response milestone records an actual value.

### C. Support movement regression

Move the Incident after it has left `New` into another support level/path stage.

Confirm the receiving/overall lifecycle does **not** regress back to `New`.

For Application, exercise the configured parallel L2 + L3 path.

### D. Transition prerequisite UX

Attempt a transition that has a genuine blocking requirement.

Confirm the requirement appears in the transition drawer itself, accepts the completion note/evidence, and the normal Incident detail does not show the old generic `0/1 complete · blocking task · Open tasks` strip.

### E. Incident workbench

On desktop:

- Scroll a long description.
- Confirm the center content scrolls.
- Confirm the right action rail remains stable and does not travel with the whole page.
- Confirm Additional fields have clean label/value spacing.

### F. Home

Confirm Home fits as a compact launchpad at the normal test laptop resolution:

- Search at the top.
- Small primary action directly below/right of search.
- Quiet metrics.
- Short Recent list.
- No unnecessary long dashboard scroll.

### G. Open Escalations

Move a normal request between support levels and confirm that movement alone does not put it into Open Escalations. A real breach/explicit escalation should.

## 5. Existing v23.1.2 SLA regression

Retest at least one Gold and one Platinum case, including one working-time target, so v23.1.4 UI fixes do not mask a regression in the v23.1.2 calendar/SLA foundation.


## v23.1.4 blocker regression — run this first

Use the Danske client persona:

```text
tinak@suntecgroup.com
password
```

1. Raise `Request → Incident → Application`.
2. Confirm the create form does **not** show Severity, Release ID/Type, S3 URL, Test Case Link, RCA Category, Root Cause, Corrective/Preventive Action, RCA Status, Approver or Exception Approver.
3. Confirm Incident Subtype, Product/Module, Region, Environment, Remarks and Attachments remain available.
4. Open the new request as Tina. Confirm there is no L1 individual-owner warning, Assign or Take Ownership action.
5. Route the L1 stage forward without assigning Tina to the stage. This must succeed.
6. Confirm a support movement does not reset an already-started Incident back to New.
7. Return Home and verify the desktop layout: My work + Raise request at the upper right of the greeting, Search below, one quiet metric row, compact Recent list, and no duplicate Raise request button below Search.

For an existing database, rerun:

```bash
npm run seed:uat:support -- --workspace=suntecgroup --apply
```

This refreshes explicit SaaS Incident subtype markers and is safe to rerun.
