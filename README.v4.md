# Service Desk v4

Service Desk v4 extends v3.01 with a reusable SLA and operational configuration layer.

## What is included

- Node.js 22 runtime baseline
- MongoDB persistence
- Microservice-style structure, without Docker
- Web gateway with EJS UI
- Organization service
- Identity service
- Issue Type Studio from v2/v3
- Reusable Workflow Studio from v3
- Client issue type availability from v2
- Client default SLA assignment
- Logout button
- Warm Command Minimal styling

## v4 additions

### SLA Studio

Create reusable SLA policies independently from issue types and clients.

Each SLA policy has:

- name
- mandatory description
- support window
- clock start trigger
- severity-based or priority-based rules
- response time
- resolution time
- status update frequency
- clock type: calendar or working hours

### Operational configuration libraries

All creation happens through buttons and modal popups. There are no new inline page forms.

Configurable libraries:

- Severities
- Priorities
- Products
- Modules under Products
- Regions
- Environments
- SLA Policies

### SLA presets

The SLA Studio includes one-click presets:

- Silver - Standard SLA
- Gold - Expedited SLA
- Platinum - Expedited SLA

These presets also seed the default S1-S4 severities, P1-P4 priorities, common environments, regions and Xelerate modules if they do not already exist.

### Client SLA assignment

On each client page, use **Assign default SLA** to choose a reusable SLA policy from a searchable modal.

## Run locally

```bash
cd service-desk-v4
cp .env.example .env
npm install
npm run dev
```

Open:

```txt
http://localhost:3000
```

MongoDB must be running locally.

## Service ports

- Web gateway: `3000`
- Organization service: `4101`
- Identity service: `4102`

## Product direction

v4 stores the SLA and operating configuration foundation. It does not yet run live SLA clocks, breach timers, pause/resume logic, escalation mails, or ticket-level SLA snapshots. Those should come after actual request creation is introduced.

