# Service Desk v30.97 — HTTPS Setup

## Local HTTPS

The uploaded test certificates are included under:

```text
certs/test.key
certs/test.crt
certs/cert.pem
```

Use this in `.env`:

```env
PORT=3000
BASE_URL=https://localhost:3000
USE_HTTPS=true
SSL_KEY_PATH=./certs/test.key
SSL_CERT_PATH=./certs/test.crt
SSL_CA_PATH=
COOKIE_SECURE=true
TRUST_PROXY=false
SESSION_TTL_DAYS=14
```

Then run:

```bash
npm start
```

Open:

```text
https://localhost:3000/suntec/login
```

Because the local certificate is self-signed/test-grade, the browser may show a warning. Accept it for local testing only.

## Production behind Railway / Nginx / Load Balancer

If TLS is terminated before Node.js, keep Node.js on HTTP and make cookies secure through proxy trust:

```env
BASE_URL=https://your-domain.example.com
USE_HTTPS=false
COOKIE_SECURE=true
TRUST_PROXY=true
```

## Production with Node.js directly serving HTTPS

Use real certificate files and paths:

```env
BASE_URL=https://your-domain.example.com
USE_HTTPS=true
SSL_KEY_PATH=/secure/path/privkey.pem
SSL_CERT_PATH=/secure/path/fullchain.pem
SSL_CA_PATH=
COOKIE_SECURE=true
TRUST_PROXY=false
```

## Notes

- Do not commit real production certificates or secrets.
- Rotate any secrets that were pasted into chat or logs.
- SharePoint should be added after HTTPS/base URL behavior is stable.
