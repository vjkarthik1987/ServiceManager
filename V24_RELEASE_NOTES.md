# Service Manager v24.0.0

## Purpose
v24.0.0 aligns the Incident model with the supplied JSM workflow and form behaviour while preserving the configurable Request -> Issue Type -> Subtype architecture.

## Incident model
- Request remains the Family.
- Incident remains an Issue Type.
- Application, Security, Infrastructure and Operational remain Incident subtypes.
- All four Incident subtypes share the common v24 Incident workflow and support path.
- Each Incident subtype uses its own configurable form and Further Classification LOV.
- Security adds the Client Data Involved field.
- S3 Bucket URL is available as Incident intake/evidence data.
- Lifecycle-only fields remain out of initial customer Incident creation.

## Workflow and routing
- JSM-aligned states include New, Analysis, L2 Support, L2 Analysis, L3 Support, L3 Analysis, Development, Release, In Build, In Quality, In Stage, In Preproduction, Verification Complete, Bank to Verify, Verify and Resolve, Resolved, Closed, Under Monitoring, On Hold, Interim Resolution, Test Failed, L2 Test Failed, Deferred, Duplicate, Not an Issue, Vendor Ticket Raised and Problem Created.
- Request to L2, Assign to L2, Assign to L3 and Escalate to L3 are modeled as distinct transitions.
- Client users cannot directly route an Incident to L3.
- L2 Support -> L2 Analysis and L3 Support -> L3 Analysis use explicit Start Analysis transitions.
- Management escalations are status-preserving actions. Only Support Manager escalation is customer-enabled.
- Support routing is independent of the source-stage individual owner so valid cross-level movement is not blocked by missing ownership.

## SLA
- Incident SLA is attached at the Incident Issue Type and inherited by the Incident subtypes.
- Customer SLA eligibility is based on Bank/customer-backed Incident context, not merely on creator identity.
- SLA recalculation preserves the original SLA start.

## Runtime / UI hardening retained
- Customer Severity intake and support reclassification.
- Internal-note privacy and partner/customer comment separation.
- Stable right-side Incident action rail.
- Compact Home experience.
- Acknowledge eligibility for valid unassigned support stages.
- Audit-at-a-glance and controlled post-creation visibility expansion.

## Upgrade note
Do not blindly rerun old provisioning scripts over an established `suntecgroup` database. Freeze v24 first, inspect/export the current Mongo configuration, and use the dedicated v24 provisioning/migration path after review.
