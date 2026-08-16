# MongoDB Data API

Generic MongoDB REST API for collections, validators, indexes, CRUD, query, and aggregation.

## Setup

```bash
pnpm install
pnpm --filter @rudra/mongodb-api build
pnpm --filter @rudra/mongodb-api start
```

## Health

```http
GET /health
```

```json
{ "status": "ok", "service": "mongodb-api" }
```

## Environment

| Variable | Description |
|----------|-------------|
| `PORT` | Override listen port |
| `HOST` | Bind address (default `0.0.0.0`) |
| `LOG_LEVEL` | `debug` \| `info` \| `warn` \| `error` |

## Status

Scaffolded in Phase 0. See root README for phase roadmap.
