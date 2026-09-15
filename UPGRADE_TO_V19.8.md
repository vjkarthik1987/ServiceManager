# Upgrade to Service Desk v19.8

1. Extract v19.8 into a new folder.
2. Copy the existing `.env` into the v19.8 root.
3. Keep the existing database URI, for example:

```env
MONGO_URI=mongodb://127.0.0.1:27017/service_desk_revised
```

4. Start MongoDB before Service Desk. On the current non-admin Windows setup:

```powershell
$mongod = "C:\Program Files\MongoDB\Server\6.0\bin\mongod.exe"

& $mongod `
  --dbpath "$env:USERPROFILE\mongodb-data\service-desk" `
  --bind_ip 127.0.0.1 `
  --port 27017
```

Leave that PowerShell window open and verify from another window:

```powershell
Test-NetConnection 127.0.0.1 -Port 27017
```

5. From the v19.8 project root:

```powershell
npm install
npm.cmd start
```

No database migration is required. Do not run the demo reset or seed command against the existing UAT database.

The end-to-end verification sequence is in `docs/v19.8-end-to-end-test-checklist.md`.
