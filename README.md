# Service Manager v23.1.6

**v23.1.6 – UAT Comments + Intake Polish** is the current Standard Bank / Danske Bank UAT baseline. It retains the v23.1.5 acknowledgement/Home hotfix and the v23.1.2–v23.1.4 SLA/workflow foundations, while fixing comment privacy, Partner commenting, request-intake step UX, and customer-reported Severity.

## v23.1.6 highlights

- Client audit/history no longer exposes Partner/SunTec-only or SunTec-only comment events.
- Partner users can **Reply to customer** or add an **Internal note** visible to Partner + SunTec.
- SunTec-only internal notes stay hidden from Partner and Client users.
- Internal-note author names remain readable.
- A single enabled Issue Family is automatically selected and omitted from the visible intake journey.
- Request intake progress remains in one horizontal rail, including five-step journeys.
- Client users can report Severity at Incident creation; Support can confirm/reclassify it later with audit history and SLA recalculation.

See `V23_1_6_RELEASE_NOTES.md` and `UAT_QUICK_START_V23.1.6.md`.

## Run

```bash
npm install
npm run test:all
npm start
```

No UAT reseed is required when upgrading from v23.1.5.
