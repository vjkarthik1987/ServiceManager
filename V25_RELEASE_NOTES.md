# Service Manager v25.0.0 — Release Notes

Release date: 15 Sep 2026

## Release focus

v25 replaces the PPT-derived workflow authority with the live Jira REST workflow definitions supplied by the support team. The four in-scope workflows are reconstructed from the captured JSON snapshots and preserve Jira transition identity and rule metadata.

## Workflow inventory

| Workflow | Jira statuses | Jira transition objects | Service Manager directed edges | Global actions |
|---|---:|---:|---:|---:|
| Incident | 27 | 58 | 100 | 3 |
| Change Request | 29 | 35 | 54 | 1 |
| Problem Management | 7 | 9 | 14 | 0 |
| Maintenance Request | 24 | 56 | 69 | 0 |

A single Jira transition can have multiple source statuses. Service Manager stores directed from→to edges, so the directed-edge count is deliberately higher than the Jira transition-object count while retaining the original Jira transition ID on every edge.

## Preserved Jira semantics

- Exact status and transition IDs
- Transition labels and multiple distinct actions with identical source/target pairs
- Validators and mandatory transition fields
- Transition screens and screen field metadata
- Conditions, including request-type and previous-status rules
- Approval configuration
- Portal/customer transition properties
- Jira post-function/action metadata for audit and future native equivalents
- Global escalation actions
- Source workflow version and SHA-256 fingerprint

## Important scope note

Service Request is not rebuilt in v25. Existing Service Request configuration remains unchanged.

Jira/JMWE plugin post-functions that create or manipulate linked Jira issues are retained as source metadata. Where Service Manager needs equivalent automated side effects, they should be implemented natively rather than treated as already executed by Jira plugins.
