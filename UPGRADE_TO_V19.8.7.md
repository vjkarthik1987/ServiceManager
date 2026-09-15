# Upgrade to v19.8.7

v19.8.7 is a UX release built directly from v19.8.5.

1. Stop the existing Service Desk processes.
2. Extract v19.8.7 to a new folder.
3. Copy your existing `.env` into the new folder.
4. Run `npm install` if `node_modules` is not already present in the new folder.
5. Ensure MongoDB is running on the configured `MONGO_URI`.
6. Start with `npm.cmd start` on Windows.

No database migration or provisioning rerun is required for this UX release.

Recommended UAT:

- Open the same request as Tenant Admin, Client User, Partner, Agent and Agent Manager to compare profile navigation/accent.
- Verify request key/title prominence.
- Verify SLA visual state and the authoritative text due-times.
- Change a workflow status from the right rail and confirm the existing comment/transition dialog still applies.
- Push an eligible request to L2/L3 and verify support routing remains separate from workflow status.
- Update a task from the compact task list.
- Post a public comment/internal note and verify history remains separate.
