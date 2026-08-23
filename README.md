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
| PDF generation from templates + row data | **PDF Generator API** |
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
  pdf-generator-api/   # Template → PDF zip (Firebase auth)

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
pnpm dev
```

On Windows / Git Bash, prefer the root scripts (`pnpm build`, `pnpm build:packages`, `pnpm dev`).  
Do **not** paste filters that contain `!` into Git Bash — `!` is history expansion and fails with `event not found`.

Safe manual equivalents:

```bash
pnpm build:packages
pnpm -r --parallel --filter "@rudra/*-api" dev
```

Start one service:

```bash
pnpm --filter @rudra/control-plane-api start
curl http://localhost:4000/health
```

> **Windows note:** root scripts use package-name filters (`@rudra/*-api`) instead of `./apps/*` path filters, which fail on Windows with “No projects matched the filters”.

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
| pdf-generator-api | 4008 |

On Render, set `POSTGRES_METADATA_URL` (Neon URL) and `POSTGRES_METADATA_ENCRYPTION_KEY` on **postgres-api** so datasource/resource registrations survive restarts.

Copy `.env.example` for local configuration.

Local dependencies (optional):

```bash
docker compose -f docker/docker-compose.yml up -d
```

## Postman

Import `postman/Rudra-Backend.postman_collection.json` and `postman/Rudra-Local.postman_environment.json` to exercise every HTTP API. See `postman/README.md`.

## Development phases

| Phase | Status | Scope |
|------|--------|-------|
| 0 | **Done** | pnpm workspace, TypeScript, shared packages, all apps build/start/`/health` |
| 1 | **Done (memory store)** | Control Plane: apps, environments, secrets, datasources, resources, fields, indexes, relations, API keys |
| 2 | **Done** | PostgreSQL Data API (schema + CRUD + query + bulk + upsert + transactions) |
| 3 | **Done** | MongoDB Data API (collections, validators, CRUD, query, aggregation, bulk) |
| 4 | **Done** | GraphQL API (dynamic schema, multi-source resolvers, depth/complexity limits) |
| 5 | **Done** | File API (S3/R2/memory presigned upload/download) |
| 6 | **Done** | Realtime API (channels, presence, Yjs adapter) |
| 7 | **Done** | WebRTC signaling (rooms, ICE, STUN/TURN creds, screen/datachannel) |
| 8 | **Done** | Function API (trusted invoke, webhooks, timeouts) |
| 9 | **Done** | Hardening baseline (limits, SSRF checks, structured errors, service READMEs) |

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
