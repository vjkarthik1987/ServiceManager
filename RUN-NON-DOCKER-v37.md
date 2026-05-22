# Service Desk v37 — Non-Docker Runbook

This build keeps the v37 notification/email platform upgrades but removes Docker-only runtime files.

## Prerequisites

- Node.js 16 or later
- MongoDB local service, MongoDB Atlas, or company MongoDB server
- SMTP credentials if you want outbound email

## Local run

1. Copy environment template:

```bash
cp .env.example .env
```

2. Edit `.env`:

```env
PORT=3000
MONGODB_URI=mongodb://127.0.0.1:27017/service_desk_v37
SESSION_SECRET=change_this_to_a_long_random_secret
UPLOAD_ROOT=./uploads
PUBLIC_APP_URL=http://localhost:3000
BASE_URL=http://localhost:3000
START_EMBEDDED_WORKERS=true
```

3. Install dependencies:

```bash
npm install
```

4. Seed demo data, only for local/demo databases:

```bash
npm run seed
```

5. Start the app:

```bash
npm start
```

6. Open:

```text
http://localhost:3000/suntec/login
```

## Worker mode

For local simplicity, use:

```env
START_EMBEDDED_WORKERS=true
```

For a separate worker process, use:

```env
START_EMBEDDED_WORKERS=false
```

Then run a second terminal:

```bash
npm run worker
```

## Railway / server run

Set environment variables in Railway/server settings:

```env
NODE_ENV=production
MONGODB_URI=<external MongoDB connection string>
SESSION_SECRET=<long random secret>
TRUST_PROXY=true
COOKIE_SECURE=true
USE_HTTPS=false
UPLOAD_ROOT=./uploads
PUBLIC_APP_URL=https://your-app-url
BASE_URL=https://your-app-url
```

Use start command:

```bash
npm start
```

## Email testing

From Admin Console, use the Email Experience Console to send a test email. All user provisioning admin-copy emails now go through the branded HTML renderer instead of raw text.
