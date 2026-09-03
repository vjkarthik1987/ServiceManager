# Service Manager v23.1.5 — Home + Acknowledge UAT Hotfix

## Why this release exists
v23.1.5 is a focused hotfix on top of v23.1.4. UAT exposed two defects:

1. The minimalist Home header could compress and let the quick-action buttons collide with the greeting.
2. An eligible Partner/L2 or SunTec/L3 user could see **Acknowledge incident**, but the POST handler rejected the action when the active SaaS stage had not yet been individually assigned.

No database schema or seed-data change is required for this release.

## Fixes

### Acknowledge eligibility
- Added a dedicated SaaS acknowledgement eligibility rule.
- Admin may acknowledge any active stage.
- The explicitly assigned stage owner may acknowledge.
- For a v23 SaaS request, an eligible actor whose client assignment, support level, and owner side match an **active unassigned stage** may acknowledge without first assigning the stage to themselves.
- If a stage is explicitly assigned to another person, the normal ownership protection remains.
- Seeded/legacy SaaS Incident recognition is used in the acknowledgement handler, so the fix does not depend only on a stored form marker.

This aligns the POST action with the workbench behavior: if the UI considers an eligible Partner/L2 or SunTec/L3 user able to work an unassigned SaaS stage, acknowledgement no longer contradicts that decision.

### Home layout
- Rebuilt the header as separate structural rows:
  - utility row with portal label + quick actions,
  - centered greeting,
  - wide centered search,
  - compact metrics,
  - recent work.
- Quick actions no longer share the same layout row as the greeting, eliminating overlap.
- Search width increased to 780px where space permits.
- Metrics/recent content use a 900px working width.
- Desktop retains the one-screen target; smaller screens fall back to natural scrolling.
- Existing Home information is retained.

## Validation
- 64 / 64 automated regression tests passed.
- 69 JavaScript/MJS files passed `node --check`.
- 48 EJS templates passed extracted-scriptlet syntax validation.
- v23 Normal Incident isolation guard passed.

## Upgrade from v23.1.4
No reseed is required.

```bash
npm install
npm run test:all
npm start
```

If deploying by file patch rather than replacing the full codebase, replace the files included in the v23.1.5 patch ZIP and restart the application.
