# Service Desk v19.8.4

This release builds on v19.8.3. No destructive database migration is required.

## Highlights
- Tenant-scoped email uniqueness (same email may exist in different organizations).
- Verified email changes for operational/client users as well as tenant admins.
- Tenant-admin mode disables client assignment controls.
- Global Users is one tabbed identity table, including admin-only identities.
- Client detail now has Overview, Users, Configuration, Operational Rules and Hierarchy tabs.
- Client Users tab shows direct and inherited access.
- Expanded role-based Help & FAQ with core Service Desk glossary.
- Regions action bar stays compact; Subregions receives a clear optional-layer divider.

Copy the existing `.env`, run `npm install`, then `npm.cmd start`.
