# SunTec cloud bootstrap — v21

Command:

```powershell
npm run bootstrap:suntec
npm run bootstrap:suntec -- --apply
```

Default workspace: `suntec`.

## Design goals

The script is one idempotent entry point for reference data, Xelerate product/module catalogue, four Issue Families, subtypes, workflows, statuses, transitions, task templates, support paths, SLA policies, client hierarchies, client-family mappings, family SLA mappings, support identities, engagement-manager portfolio scope and historical UAT requests.

A JSON configuration backup is written before `--apply` changes are made.

## Xelerate product catalogue

The bootstrap creates Product `Xelerate` and these service-desk capability areas:

- Enterprise Product Catalog
- Relationship-Based Pricing
- Billing & Statements
- Deal Management
- Offer Management
- Loyalty Management
- Indirect Taxation
- E-Invoicing
- Channel Management
- Account Analysis
- Quote-to-Cash Management
- Ecosystem Management

The seed list was prepared from SunTec public product pages. Source URLs remain in `scripts/bootstrap-suntec-cloud.mjs` for traceability.

## Standard Bank model

- Standard Bank (`STDBNK`)
  - Standard Bank Corporate Banking (`STDCOR`)
  - Standard Bank Retail Banking (`STDRTL`)

Enabled family: Ticket only.

Operational paths:

- Ticket / Incident → direct SunTec L3
- Ticket / Service Request → direct SunTec L3
- Ticket / Change Request → direct SunTec L3
- Ticket / Query → direct SunTec L3

There is no client operational support stage in these direct paths, so no customer operational task checklist is generated. Customer clarification remains available through comments and configured return/customer-facing states.

Family SLA:

- Ticket → Gold – Expedited SLA
- child clients inherit the mapping

Normal-support team:

- Deepesh C — Agent Manager — `deepeshc@suntecgroup.com`
- Nisha Rathinamani — Agent — `nishar@suntecgroup.com`
- Anitha K P — Agent — `anithakp@suntecgroup.com`
- Subramoni A — Agent — `subramonia@suntecgroup.com`

## Danske Bank SaaS model

- Danske Bank (`DANSKE`)
  - Danske Bank Corporate Banking (`DANCOR`)
  - Danske Bank Retail Banking (`DANRTL`)

Enabled families:

- Incident
- Maintenance Request
- Service Request

Application Incident uses L1 Bank → L2 Partner → L3 SunTec as its standard path. By default S1/S2 Production/DR can activate L2 + L3 in parallel after L1. Security, Operational and Infrastructure use their configured L2/L3 flows. Maintenance and Service Request subtypes use their configured process-specific paths.

Family SLA:

- Incident → Xelerate SaaS Sample Incident SLA
- Service Request → no Incident SLA assignment
- Maintenance Request → no Incident SLA assignment
- child clients inherit the Incident mapping

SaaS UAT identities:

- Jisha S — Agent Manager / L3 — `jisha@suntecgroup.com`
- Rajani Ramakrishnan — Partner / L2 — `rajanir@suntecsbs.com`
- Rajani Ramakrishnan — Agent / L3 — `rajanir@suntecgroup.com`

The duplicate human name with different email identities is deliberate for Partner-versus-SunTec UAT.

## Engagement managers

Both of these identities are assigned to Standard Bank and Danske Bank root clients with child inheritance:

- Sudheer Padiyar — `padiyars@suntecgroup.com`
- Madhu M — `madhu@suntecgroup.com`

Engagement Manager is a portfolio visibility/oversight role in v21. It is not included in normal L3 ownership eligibility.

## Historical UAT data

The bootstrap creates 30 stable requests for each of the six client records, for 180 total request slots spanning the trailing year. Request numbers use `<CLIENT>-H0001` through `<CLIENT>-H0030`, so rerunning the bootstrap does not duplicate them.

The seed deliberately varies request family/subtype, dates, status, support level, owner, Xelerate module, severity/priority, environment, comments, tasks and SLA RAG state so dashboard and filter UAT is meaningful.

## Useful options

```powershell
npm run bootstrap:suntec -- --validate-only
npm run bootstrap:suntec -- --organization=suntec
npm run bootstrap:suntec -- --parallel-mode=all-l2
```

The older `--assign-sla` argument is retained for command-line compatibility, but v21's baseline SLA assignments are explicit client + family mappings created by the bootstrap itself.
