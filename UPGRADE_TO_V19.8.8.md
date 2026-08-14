# Upgrade to v19.8.8

v19.8.8 builds on the v19.8.7 workbench and keeps the v19.8.5 request/workflow foundation.

## Upgrade

1. Keep your existing MongoDB database.
2. Extract v19.8.8 to a new folder.
3. Copy the existing `.env` into the new folder.
4. Run `npm install` if dependencies are not already installed for the new folder.
5. For the new default forward/return support movements and the corrected Ticket L2 Partner ownership model, run a dry provisioning preview:
   `npm run provision:suntecsds-service-model`
6. Review the preview, then apply:
   `npm run provision:suntecsds-service-model -- --apply`
7. Start the application with `npm.cmd start`.

No destructive database migration is required. Existing requests remain compatible. The workbench reconciles active stages against the current configured support path so owner-side changes and newly provisioned return routes are visible on existing requests. If an old stage owner is no longer eligible for the newly configured owner-side, the stage is presented as needing ownership/reassignment. The next configured support movement refreshes that request's support-path snapshot.
