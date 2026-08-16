# PostgreSQL Data API

Generic PostgreSQL REST API for dynamic tables, fields, indexes, relations, and CRUD.

## Setup

```bash
pnpm install
pnpm --filter @rudra/postgres-api build
pnpm --filter @rudra/postgres-api start
```

## Health

```http
GET /health
```

```json
{ "status": "ok", "service": "postgres-api" }
```

## Environment

| Variable | Description |
|----------|-------------|
| `PORT` | Override listen port |
| `HOST` | Bind address (default `0.0.0.0`) |
| `LOG_LEVEL` | `debug` \| `info` \| `warn` \| `error` |

## Status

Scaffolded in Phase 0. See root README for phase roadmap.
