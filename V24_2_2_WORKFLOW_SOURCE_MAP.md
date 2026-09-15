# v24.2.2 Workflow Source Map

This release treats the supplied JSM workflow decks as the workflow source of truth:

- `Incident(4).pptx` -> `WF_SAAS_INCIDENT`
- `Problem(3).pptx` -> `WF_SAAS_PROBLEM`
- `CR Workflow(3).pptx` -> `WF_SAAS_CHANGE`
- `Maintenance Request(1).pptx` -> `WF_SAAS_MAINTENANCE`

## UAT clarification overriding a permissive JSM transition

The Incident JSM deck shows `Request to L2 Support` with `New`, `Analysis`, `In Preproduction` and `Test Failed` as source statuses. The agreed Service Manager customer rule is:

`New -> Analysis` first, then `Request to L2 Support -> L2 Support`.

Therefore customer transition `New -> L2 Support` is intentionally not exposed. This is a product/UAT rule, not an extraction omission.

## Runtime behavior

Cross-support-level customer workflow actions (for example Request to L2 Support) remain visible in the Change status menu. The web layer translates the selected workflow action into the existing guarded support-path move rather than performing a raw status mutation. This preserves support-level state, audit, ownership and notification behavior.
