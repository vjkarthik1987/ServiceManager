# v23.1.2 UAT Quick Start

## 1. Install

```bash
cp .env.example .env
npm install
```

Confirm the MongoDB connection and service ports in `.env` before continuing.

## 2. Run automated checks

```bash
npm run test:all
```

## 3. Seed the UAT workspace

The scripts are idempotent. Preview first if you are running them against an existing database.

### A. Master data

```bash
npm run seed:uat:master -- --workspace=suntecgroup --dry-run
npm run seed:uat:master -- --workspace=suntecgroup --apply
```

Seeds Standard Bank/Danske Bank hierarchy, severity, priority, Xelerate/modules, regions/subregions, environments and UAT business calendars.

### B. Users and SunTec SLA policies

```bash
npm run seed:uat:users-slas -- --workspace=suntecgroup --dry-run
npm run seed:uat:users-slas -- --workspace=suntecgroup --apply
```

All seeded UAT accounts use password `password` with forced password change disabled. Silver, Gold and Platinum policies are seeded for L2/L3 PROD/DR Incident SLA use.

### C. Support plans, workflows and Support Paths

```bash
npm run seed:uat:support -- --workspace=suntecgroup --dry-run
npm run seed:uat:support -- --workspace=suntecgroup --apply
```

Default UAT assignment:

- Standard Bank → Platinum
- Danske Bank → Gold

Override when needed, for example:

```bash
npm run seed:uat:support -- --workspace=suntecgroup --standard-plan=gold --danske-plan=silver --apply
```

## 4. Start the platform

```bash
npm start
```

Use `/` as the normal entry point. `/setup` is only needed for an uninitialized installation.

## 5. First UAT smoke path

1. Sign in as a Standard Bank customer.
2. Raise `Incident → Application`, Xelerate/`Pricing`, `PROD`.
3. Move/classify into the configured severity flow and confirm the Platinum SLA.
4. Confirm Application support starts the configured L2 + L3 support path.
5. Verify customer view does not show internal task/workflow clutter.
6. Verify only accountable tasks appear where required.
7. Verify `Bank to Verify`, resolution and closure approval behaviour.
8. Repeat on Danske Bank and confirm Gold SLA behaviour.
9. Exercise a working-time S2/S3 scenario across a weekend/holiday.
10. Confirm at-risk and breach notifications are emitted once per target event.
