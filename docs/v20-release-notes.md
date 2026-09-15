# v20 release notes

v20 is a stability-and-clarity release on top of the corrected v19.8.9 line. It keeps the Jira-style request workbench, client/partner/SunTec stage ownership, bidirectional support routing, activity tabs, profile themes, and request-list colour cues.

## Fixed: comments render correctly immediately

The AJAX comment renderer now creates the same DOM structure as the server-rendered comment list: avatar, content wrapper, metadata, body, attachments, and the `new-comment` animation class. A newly posted comment therefore looks correct immediately; a browser refresh is no longer required. The Comments & updates count also increments immediately.

## Improved: “Me” in ownership and assignment

Eligible assignees are annotated and sorted so the signed-in eligible identity is listed first as `Me · Name · email` in owner selectors. If the current stage is assigned to the signed-in user, the ownership card shows `Me` prominently while retaining the user name underneath for audit clarity.

This applies to contextual stage assignment:
- L1 / Customer: eligible client users for that client scope
- L2 / Partner: eligible partner users for that client scope
- L3 / SunTec: eligible SunTec support users

## Queue colour cues retained

v20 includes the v19.8.9 request-list colour patch for status, request type, support level, and rows assigned to the signed-in user.

## Upgrade impact

No destructive database migration is required. No provisioning rerun is required solely for v20. Copy the existing `.env`, install dependencies if needed, and restart the application.
