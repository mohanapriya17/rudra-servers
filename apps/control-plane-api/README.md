# Control Plane API

Shared configuration plane for the Rudra backend platform.

Stores **metadata only** — not application data.

Base URL: `/api/v1`

## Features (Phase 1)

- Applications CRUD
- Environments
- Encrypted secrets (values never returned after create)
- Data sources
- Resources / fields / indexes / relations metadata
- API keys (hashed at rest, full key shown once)

## Setup

```bash
pnpm install
pnpm --filter @rudra/control-plane-api build
pnpm --filter @rudra/control-plane-api start
```

Default port: `4000`

## Environment

| Variable | Description |
|----------|-------------|
| `PORT` / `CONTROL_PLANE_API_PORT` | Listen port |
| `SECRETS_ENCRYPTION_KEY` | AES key material for secrets (≥16 chars) |
| `CONTROL_PLANE_DATABASE_URL` | Neon/Postgres URL (optional; memory store used if unset) |
| `JWT_SECRET` | Shared JWT secret |

## Example

```bash
curl -X POST http://localhost:4000/api/v1/apps \
  -H 'content-type: application/json' \
  -d '{"name":"Inventory Application"}'
```

## Secrets

```http
POST /api/v1/secrets
```

Response includes `configured: true` and **never** includes `value`.

## Deployment

Deploy as its own Render service (`rudra-control-plane`). Not required for every app stack, but required when other services need shared metadata.
