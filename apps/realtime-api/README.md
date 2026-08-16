# Realtime / WebSocket API

Generic WebSocket channels, presence, and Yjs adapter surface.

## Setup

```bash
pnpm install
pnpm --filter @rudra/realtime-api build
pnpm --filter @rudra/realtime-api start
```

## Health

```http
GET /health
```

```json
{ "status": "ok", "service": "realtime-api" }
```

## Environment

| Variable | Description |
|----------|-------------|
| `PORT` | Override listen port |
| `HOST` | Bind address (default `0.0.0.0`) |
| `LOG_LEVEL` | `debug` \| `info` \| `warn` \| `error` |

## Status

Scaffolded in Phase 0. See root README for phase roadmap.
