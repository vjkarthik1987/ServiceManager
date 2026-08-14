# v9 Support Paths

A workflow controls request status movement. A support path independently controls support ownership movement.

Example:

- Workflow status: New → Assigned → Analysis → Resolution → Closed
- Support ownership: L1 Client → L2 Partner → L3 SunTec

A Level 2 issue type references one reusable workflow and one reusable support path.

## Movement rule

Each support path movement rule defines:

- from support level
- to support level
- user-facing action label
- whether reason and comment are mandatory
- whether the workflow status stays unchanged or returns to its start status

Requests store snapshots of both workflow and support path definitions when created. Older requests can use the current configuration assigned to their Level 2 issue type when an action is first performed.
