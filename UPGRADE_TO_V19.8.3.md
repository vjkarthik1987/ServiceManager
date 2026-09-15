# Upgrade to v19.8.3

1. Extract v19.8.3 into a new folder.
2. Copy your existing `.env` into the v19.8.3 project root.
3. Keep the same `MONGO_URI`; no destructive migration is required.
4. Run `npm install` and then `npm.cmd start`.
5. For local UAT use `MAIL_MODE=console` so activation, reset and verification links are printed without attempting SMTP.

Existing organizations, clients, requests, workflows and tasks remain compatible. The optional `subregionId` field is additive and may remain blank for every existing client.
