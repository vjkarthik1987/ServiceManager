# Workflow Orchestration in v19.4

v19.4 merges the mature v18.04 service-desk operation layer with the workflow and support-path model developed in the v19.1 branch.

## Final functional model

1. A request is classified into a Level 1 and Level 2 request type.
2. The effective support path is resolved from:
   - the client and Level 2 subtype;
   - optional severity conditions;
   - optional environment conditions;
   - inherited parent-client rules;
   - and finally the Level 2 subtype default when no client rule matches.
3. Every support-path stage (L1, L2, and L3) may have its own workflow.
4. Movement rules can be sequential or parallel.
5. A parallel rule can activate L2 and L3 together and identify one stage as primary.
6. Every active stage has an independent workflow status.
7. Workflow statuses may contain default task templates.
8. Entering a workflow status generates request tasks for that stage.
9. Blocking tasks must be completed or cancelled before that stage can progress.
10. The request remains open until all active stages are resolved, final, or cancelled.

## Configuration order

1. Create workflows in **Workflow Studio**.
2. Add statuses and transitions.
3. Add default tasks under the statuses that should create work.
4. Create a support path.
5. Add L1/L2/L3 stages and assign a workflow to each stage.
6. Add sequential or parallel movement rules.
7. Assign the support path as a subtype default, or add a client operational rule.
8. For special handling, add a more specific client rule using severity and/or environment conditions.

## Rule precedence

- Rules defined directly on the selected client are checked before inherited parent rules.
- A rule with severity and environment conditions is preferred over a broad rule for the same subtype.
- Parent rules apply only when `inheritToChildren` is enabled.
- The Level 2 subtype default support path is used when no client rule matches.

## Runtime behavior

- A request starts in the workflow assigned to its initial support stage.
- Moving to a sequential target replaces the active stage with the target stage.
- Moving through a parallel rule activates all target stages together.
- Each active stage displays its workflow, current status, tasks, and blockers.
- Changing L2 status does not change L3 status, and vice versa.
- When a primary stage finishes while another stage remains unfinished, the unfinished stage becomes primary so the overall request does not appear closed prematurely.
- Closing a multi-stage request is prevented while any blocking task or unfinished stage remains.

## Compatibility

Existing v18.04 requests without `activeStages` continue to render using a fallback stage created from their current support level, workflow, and status. New requests store stage and task snapshots so later configuration changes do not rewrite historical execution.
