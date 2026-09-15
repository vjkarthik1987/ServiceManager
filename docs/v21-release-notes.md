# Service Desk v21 release notes

## Purpose

v21 turns the `suntec` cloud environment into a realistic UAT baseline rather than an empty configuration shell. It combines service-model configuration, role/scoping setup, family-specific SLA, a full year of deterministic request history, dashboard data, and usability improvements around Requests, Filters and Help.

## SLA model

Client SLA is no longer limited to one blanket default. `familySlaAssignments` map a Client + Issue Family to an SLA policy and may inherit to child clients.

Bootstrap baseline:

- Standard Bank / Ticket → Gold – Expedited SLA.
- Danske Bank / Incident → Xelerate SaaS Sample Incident SLA.
- Danske Service Request and Maintenance Request → no Incident SLA mapping.

Legacy `defaultSlaPolicyId` remains supported as fallback for pre-v21 data.

## UAT portfolio

Normal support:

- Standard Bank (`STDBNK`)
- Standard Bank Corporate Banking (`STDCOR`)
- Standard Bank Retail Banking (`STDRTL`)
- Ticket only, direct to SunTec L3, no customer operational task stage.

SaaS support:

- Danske Bank (`DANSKE`)
- Danske Bank Corporate Banking (`DANCOR`)
- Danske Bank Retail Banking (`DANRTL`)
- Incident, Maintenance Request and Service Request.
- SaaS support paths retain Bank/L1, Partner/L2 and SunTec/L3 models including the configured critical parallel path.

## UAT users

Normal support L3:

- Deepesh C — Agent Manager — `deepeshc@suntecgroup.com`
- Nisha Rathinamani — Agent — `nishar@suntecgroup.com`
- Anitha K P — Agent — `anithakp@suntecgroup.com`
- Subramoni A — Agent — `subramonia@suntecgroup.com`

SaaS:

- Jisha S — Agent Manager/L3 — `jisha@suntecgroup.com`
- Rajani Ramakrishnan — Partner/L2 — `rajanir@suntecsbs.com`
- Rajani Ramakrishnan — Agent/L3 — `rajanir@suntecgroup.com`

Engagement:

- Sudheer Padiyar — `padiyars@suntecgroup.com`
- Madhu M — `madhu@suntecgroup.com`

Both Engagement Managers cover Standard Bank and Danske Bank roots with child inheritance. Engagement Manager is a portfolio visibility role and is excluded from normal L3 owner selection.

## Historical data

The bootstrap creates 30 stable historical UAT requests for each of the six client records, for 180 total request slots. Data spans approximately 15 August 2025 through 14 August 2026 and intentionally varies:

- issue family and subtype;
- severity, priority, environment and Xelerate module;
- open/resolved/closed/hold/waiting state;
- ownership and unassigned work;
- green/amber/red/grey SLA health;
- comments, timeline and workflow task snapshots.

Request IDs use the stable format `<CLIENT>-H0001` … `<CLIENT>-H0030`, making the bootstrap rerunnable without duplication.

## Requests and Filters

- Request navigation is labelled Requests.
- Requests includes All requests and Requests assigned to me.
- Filters is more compact and uses a one-line segmented visibility selector.
- Save Filter is collapsed until needed.
- Filter queries can open directly in Requests.
- Requests shows an Active filter banner while that context is active.

## Help & FAQ

FAQ now includes scenario-driven material for Standard Bank direct-to-L3, Danske sequential and parallel SaaS support, send-back routing, assignments, SLA, historical UAT data, Filters, dashboards and Engagement Manager responsibilities.

## Compatibility

No destructive migration is required. Existing clients using legacy default SLA continue to resolve through the fallback logic until family-specific mappings are configured.
