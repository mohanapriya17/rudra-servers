# GraphQL API

Dynamic GraphQL server with configurable schemas and multi-source resolvers.

## Setup

```bash
pnpm install
pnpm --filter @rudra/graphql-api build
pnpm --filter @rudra/graphql-api start
```

## Health

```http
GET /health
```

```json
{ "status": "ok", "service": "graphql-api" }
```

## Environment

| Variable | Description |
|----------|-------------|
| `PORT` | Override listen port |
| `HOST` | Bind address (default `0.0.0.0`) |
| `LOG_LEVEL` | `debug` \| `info` \| `warn` \| `error` |

## Status

Scaffolded in Phase 0. See root README for phase roadmap.
