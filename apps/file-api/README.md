# File Management API

Presigned upload/download against S3-compatible object storage (Cloudflare R2, AWS S3, MinIO).

Binary files are **not** stored in Postgres.

## Flow

1. `POST /api/v1/files/upload-url`
2. Client uploads directly to object storage
3. `POST /api/v1/files/:id/complete`
4. `GET /api/v1/files/:id/download-url`

## Setup

```bash
pnpm --filter @rudra/file-api start
```

Port: `4006`

Env: `S3_ENDPOINT`, `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_BUCKET`

Without S3 credentials, an in-memory provider is used (dev/test only).
