# Service Desk v4 - SLA and Operational Configuration

v4 introduces the configuration foundation needed before ticket creation.

## Master libraries

The organization owns these reusable libraries:

- Severities: impact scale, usually S1-S4
- Priorities: urgency scale, usually P1-P4
- Products
- Modules under products
- Regions with timezones
- Environments with default SLA applicability
- SLA policies

## SLA policy design

An SLA policy is reusable. It can later be assigned as a default policy to clients and snapshotted onto tickets when requests are created.

Each policy stores:

- support window
- clock start trigger
- rules by severity or priority
- response time
- resolution time
- update frequency
- clock type

## v4 boundary

v4 does not execute SLA timers. It only defines the configuration. Timer computation, pause/resume logic, escalation and breach detection should be added after actual ticket creation.
