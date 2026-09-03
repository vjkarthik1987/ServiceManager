# v23.1.5 UAT Quick Check

## 1. Home
Log in as Tina:

- `tinak@suntecgroup.com`
- password: `password`

Confirm:
- `My work` and `+ Raise request` are in the utility row and do not overlap the greeting.
- `Good afternoon, Tina` is centered on its own line.
- Search is wide and fully readable.
- Metrics and recent requests remain visible without normal desktop scrolling.

## 2. Partner acknowledgement
Log in as:

- `rajanir@suntecsbs.com`
- password: `password`

Open a Danske SaaS Application Incident with an active L2 Partner stage and response SLA outstanding.

If the stage is unassigned, click **Acknowledge incident**. It should succeed without requiring Take Ownership first.

## 3. SunTec L3 acknowledgement
Log in as:

- `rajanir@suntecgroup.com`
- password: `password`

Open the same/another request with an active L3 SunTec stage and response SLA outstanding. An unassigned eligible L3 stage may be acknowledged directly.

## Protection check
If an active stage is explicitly assigned to a different eligible user, another user should not gain ownership merely by acknowledging it.

## No database work
v23.1.5 does not require UAT seed scripts to be rerun.
