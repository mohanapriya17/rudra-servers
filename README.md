# Rudra Headless Backend Platform

Generic backend primitives for applications built with Rudra.

This is **not** a domain backend (CRM / ecommerce / project management). Applications compose these services as needed.

## Which service should I use?

| Need | Service |
|------|---------|
| Relational CRUD | **PostgreSQL API** |
| Document storage | **MongoDB API** |
| Multi-source flexible querying | **GraphQL API** |
| Realtime collaboration / channels | **Realtime API** |
| Audio / video / screen share | **WebRTC API** |
| Uploads / downloads | **File API** |
| Custom business logic | **Function API** |
| Apps, envs, secrets, metadata, API keys | **Control Plane** |

## Monorepo layout

```text
apps/
  control-plane-api/   # metadata & configuration
  postgres-api/        # PostgreSQL Data API
  mongodb-api/         # MongoDB Data API
  graphql-api/         # Dynamic GraphQL
  realtime-api/        # WebSocket / presence / Yjs adapter
  webrtc-api/          # Signaling / rooms / ICE
  file-api/            # S3-compatible files
  function-api/        # Trusted functions / webhooks

packages/
  auth/ config/ contracts/ errors/ logging/
  metadata/ policies/ rate-limit/
  postgres-driver/ mongodb-driver/ storage-driver/ testing/
```

Each app is independently runnable and deployable.

## Quick start

```bash
pnpm install
pnpm build
```

Start one service:

```bash
pnpm --filter @rudra/control-plane-api start
curl http://localhost:4000/health
```

Default ports:

| Service | Port |
|---------|------|
| control-plane-api | 4000 |
| postgres-api | 4001 |
| mongodb-api | 4002 |
| graphql-api | 4003 |
| realtime-api | 4004 |
| webrtc-api | 4005 |
| file-api | 4006 |
| function-api | 4007 |

Copy `.env.example` for local configuration.

Local dependencies (optional):

```bash
docker compose -f docker/docker-compose.yml up -d
```

## Development phases

| Phase | Status | Scope |
|------|--------|-------|
| 0 | **Done** | pnpm workspace, TypeScript, shared packages, all apps build/start/`/health` |
| 1 | **Done (memory store)** | Control Plane: apps, environments, secrets, datasources, resources, fields, indexes, relations, API keys |
| 2 | **Done** | PostgreSQL Data API (schema + CRUD + query + bulk + upsert + transactions) |
| 3 | Next | MongoDB Data API |
| 4 | Planned | GraphQL API |
| 5 | Planned | File API |
| 6 | Planned | Realtime API + Yjs adapter |
| 7 | Planned | WebRTC signaling (scaffold exists) |
| 8 | Planned | Function API |
| 9 | Planned | Hardening only |

## Error format

All REST services return:

```json
{
  "error": {
    "code": "RESOURCE_NOT_FOUND",
    "message": "Resource not found",
    "requestId": "..."
  }
}
```

## Architecture boundary

Stop adding new backend products once these primitives exist. Anything application-specific should be built **using** these services, not folded into the platform.
