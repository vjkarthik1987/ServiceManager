# v25 Workflow Source Map

The live Jira JSON snapshots below are the authoritative workflow source for v25.

| Service Manager workflow | Jira snapshot | Authority |
|---|---|---|
| `WF_SAAS_INCIDENT` | `config/v24-saas/jira-source/incident.full.json` | `Copy of Incident Workflow-26/12/25-CBAJIRA` |
| `WF_SAAS_CHANGE` | `config/v24-saas/jira-source/change.full.json` | `Change Request Workflow-CBAJIRA` |
| `WF_SAAS_PROBLEM` | `config/v24-saas/jira-source/problem.full.json` | `Problem Management Workflow-CBAJIRA` |
| `WF_SAAS_MAINTENANCE` | `config/v24-saas/jira-source/maintenance.full.json` | `SunTec:Maintenance Request workflow-23/3/26` |

The builder `scripts/build-v25-workflows-from-jira.mjs` projects those snapshots into the Service Manager configuration while preserving Jira metadata. Multi-source Jira transitions are expanded into separate directed edges carrying the same `jiraTransitionId`.

PPT workflow decks and older v24.x source maps remain in the repository only for history and traceability and are not the v25 workflow authority.
