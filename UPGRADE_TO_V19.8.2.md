# Upgrade to v19.8.2

1. Extract v19.8.2 into a new folder.
2. Copy the existing `.env` into the v19.8.2 project root.
3. Keep the same `MONGO_URI` if you want to retain existing data.
4. Run `npm install` and `npm.cmd start`.

No mandatory database migration is required. Mongoose adds new token/status fields lazily as records are updated.

For local testing use `MAIL_MODE=console`; activation and password-reset links will be printed in the terminal.
