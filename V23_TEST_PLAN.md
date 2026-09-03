# Service Manager v23.0.1 — Test Plan

The executable manual checklist is in:

- `V23_UAT_CHECKLIST.md`
- `V23_UAT_CHECKLIST.csv`

The checklist contains 79 cases across installation/preflight, normal Incident regression, SaaS Incident forms/workflow/SLA, Service Request forms/workflows, Problem, Change, Maintenance, approvals, visibility, audit and isolation.

## Mandatory automated checks

```powershell
.\V23.ps1 verify
```

This runs the normal Incident hard guard and the Node v23 test suites.

## Release-blocking principle

All P0 cases are blockers. The `NI-*` cases are especially important: they prove that normal/non-SaaS Incident Management has not been touched by v23.
