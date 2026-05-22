# Service Desk v30.97.2 — Cloudinary Persistent Storage

This build keeps the v30.97 HTTPS support and adds Cloudinary as a persistent attachment storage provider.

## Required env for Cloudinary

```env
STORAGE_PROVIDER=cloudinary
CLOUDINARY_CLOUD_NAME=your_cloud_name
CLOUDINARY_API_KEY=your_api_key
CLOUDINARY_API_SECRET=your_api_secret
CLOUDINARY_ROOT_FOLDER=ServiceDesk
```

Keep local upload settings as fallback/reference:

```env
UPLOAD_ROOT=./uploads
```

## Where files are saved

Cloudinary Media Library:

```text
ServiceDesk/
  <tenantId>/
    <issueId>/
      uploaded-file
```

MongoDB stores metadata only:
- original filename
- generated filename
- mime type
- size
- Cloudinary public_id
- Cloudinary secure URL
- tenant / issue / comment references
- visibility flags

Clients still access files only through the Service Desk application. The app checks RBAC and streams the file from Cloudinary.

## Test endpoint

After logging in as superadmin:

```http
GET  /suntec/admin/integrations/cloudinary/config
POST /suntec/admin/integrations/cloudinary/test
```

The POST test validates Cloudinary credentials.

## Rollback

Set:

```env
STORAGE_PROVIDER=local
```

to go back to local disk uploads.
