# Service Desk v38 — Workflow Governance Experience

Built on v37 non-Docker notification platform.

## Run

```bash
cp .env.example .env
npm install
npm run seed
npm start
```

Open `http://localhost:3000/suntec/login`.

## v38 highlights

- Request type first intake flow: Issue, Change Request, Query, optional Service Request.
- Admin Console → Request Taxonomy to enable request types and define optional second-level classifications.
- Type-specific guided questions without a dynamic form builder.
- Mandatory severity, request type, and classification when configured.
- Single module auto-selection on issue creation.
- Home page resolution calendar for SLA/target dates.
- Recent Activity moved below Recent Issues.
- Sidebar reordered: Issues → Users → Products → Modules → Dashboard → Reports.
- Regional Head and Support Head role groundwork.
- Dashboard/table readability polish.
- Email Experience Console theme overlap cleanup.

## Important design guardrail

v38 does not introduce custom per-client form builders or JSON-schema field designers. The platform remains opinionated: request type + optional classification + standard question set.
