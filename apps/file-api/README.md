# File Management API

Presigned upload/download against S3-compatible object storage.

## Setup

```bash
pnpm install
pnpm --filter @rudra/file-api build
pnpm --filter @rudra/file-api start
```

## Health

```http
GET /health
```

```json
{ "status": "ok", "service": "file-api" }
```

## Environment

| Variable | Description |
|----------|-------------|
| `PORT` | Override listen port |
| `HOST` | Bind address (default `0.0.0.0`) |
| `LOG_LEVEL` | `debug` \| `info` \| `warn` \| `error` |

## Status

Scaffolded in Phase 0. See root README for phase roadmap.
