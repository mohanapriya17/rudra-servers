# Function / Action API

Trusted function invocation, webhooks, and pluggable execution.

## Setup

```bash
pnpm install
pnpm --filter @rudra/function-api build
pnpm --filter @rudra/function-api start
```

## Health

```http
GET /health
```

```json
{ "status": "ok", "service": "function-api" }
```

## Environment

| Variable | Description |
|----------|-------------|
| `PORT` | Override listen port |
| `HOST` | Bind address (default `0.0.0.0`) |
| `LOG_LEVEL` | `debug` \| `info` \| `warn` \| `error` |

## Status

Scaffolded in Phase 0. See root README for phase roadmap.
