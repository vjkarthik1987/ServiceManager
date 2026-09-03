# Service Desk v22 — P0 SaaS UAT Hardening

Base: v21-cloud-baseline

Implemented:
1. Client portal cleanup
   - Removed "Raising this for someone else?"
   - Removed Client "My Tasks"
   - Hidden Workflow Tasks/Open Tasks for client users
2. Client lifecycle
   - Need Information -> Submit Information
   - Resolved -> Accept & Close / Issue Not Resolved
3. SaaS Incident workflow
   - No status-generated automatic tasks
   - Old v21 auto-generated tasks no longer block incident closure
   - Progressed incidents cannot reverse to New
4. SLA
   - Not-applicable SLA cards are hidden
   - L1/non-applicable levels remain hidden through the existing level applicability model
   - Query/Service Request are not SLA-bearing in the current SaaS UAT service model
   - Support can change severity after creation
   - Severity changes recalculate SLA without resetting the SLA start time
5. Notifications
   - Existing creation/status/close/comment notifications retained
   - Assignment notifications added
   - Need Information and Resolution get explicit mail events
   - SLA at-risk/breach watcher runs every 60 seconds for active tenant workspaces
   - Requester + active stage assignees are included as recipients
6. Open Escalations
   - No longer maps to "all open"
   - Shows SLA-at-risk/breached work or requests that actually moved support levels

Safety:
- A backup of every changed source file is created under:
  .v21-backup-before-v22-p0/

Important:
- Configure SMTP on the server for actual mail delivery.
- The SLA watcher runs inside the web process in v22 UAT. A separate notification worker can replace it later without changing the request-service contract.
