# ESOP v27.1.0

This release fixes the create-issue auditTrail crash, makes the left navigation independently scrollable, stabilizes Jira mock validation for local smoke tests, and adds per-entity four-character acronyms for issue numbering (for example, ACME-1001).

## Local smoke testing with Jira mock mode
- `JIRA_MOCK_MODE=true`
- `ALLOW_JIRA_MOCK_OUTSIDE_TEST=true`

# ESOP v25.9.0

This drop adds commitment-engine upgrades, entity-linked SLA/OLA defaults, product master, dashboard UX polish, and runtime event logging.

ESOP v25.8.0

# ESOP v25.7.0

This release upgrades the SLA engine into a broader service commitment framework.

## Highlights
- Blocker severity added across the platform
- SLA / OLA / Custom agreement policies
- Global / client / subclient scoping
- Parent inheritance and override modes
- Metric targets in minutes, hours, or days
- Severity-band timers for response, acknowledgement, workaround, resolution, update cadence, and closure confirmation

## Run
- `npm install`
- `npm run seed`
- `npm start`

## UI
Open `/{tenantSlug}/admin/sla-policies` to define commitment policies.


## v25.7 Jira intake bridge
- pushes every ESOP issue into Jira project `PTP`
- uses Jira work type `Bug`
- sends only stable create fields
- uses the ESOP issue title as Jira summary


## v30.8 notes
- New users are created with temporary password `password`.
- Provisioning email goes to `USER_PROVISIONING_EMAIL` or defaults to `karthikvj@suntecsbs.com`.
- SMTP must be configured for outbound email delivery.


## HTTPS
Set `USE_HTTPS=true` and provide `SSL_KEY_PATH` and `SSL_CERT_PATH` in your `.env` to run ESOP over HTTPS.


## Atlas + Railway quick start
1. Copy `.env.example` to `.env`.
2. The example file is already pointed at your MongoDB Atlas cluster and uses database `esop_v30_8_8_4`.
3. Run `npm install`.
4. Run `npm run seed`. This seed clears and recreates the demo `suntec` and `acme` tenants.
5. Run `npm start`.

### Railway environment
Set these variables in Railway:
- `MONGODB_URI`
- `SESSION_SECRET`
- `NODE_ENV=production`
- `PORT` supplied by Railway
- `TRUST_PROXY=true`
- `COOKIE_SECURE=true`
- `USE_HTTPS=false`

### Important seed note
The bootstrap seed deletes and recreates seeded tenants before inserting demo data. Do not run it against a database that contains production tenant data you want to keep.
