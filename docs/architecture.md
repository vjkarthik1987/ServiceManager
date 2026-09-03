# Service Desk v3 Architecture Note

v3 keeps workflows independent and reusable.

```txt
Organization
  → Issue Type Library
      → Level 1 Issue Types
          → Level 2 Issue Types
              → assignedWorkflowId

Organization
  → Workflow Library
      → Workflow
          → Statuses
          → Transitions
          → Client-visible labels

Organization
  → Clients
      → Enabled Level 1 / Level 2 issue types
```

## Ownership

The organization service owns:

- organizations
- clients
- global issue type library
- reusable workflow library
- workflow assignment to Level 2 issue types

The web gateway renders:

- Issue Type Studio
- Workflow Studio
- Client availability
- Client intake preview

## Workflow model

A workflow has:

- name
- description
- statuses
- transitions

A status has:

- internal status name
- mandatory description
- client-visible label
- status type: start, normal, hold, waiting, resolved, final, cancelled
- customer visibility flag
- display order

A transition has:

- fromStatusId
- toStatusId

This allows forward movement, backward movement, reopen, hold, cancellation, and custom paths.

## Important product rule

Workflow is independent. It does not belong to an issue type.

Level 2 issue types point to a workflow.

That makes workflows reusable.
