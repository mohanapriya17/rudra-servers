# Realtime / WebSocket API

Generic realtime server — not a chat product.

## Features

- WebSocket channels (`subscribe` / `publish` / `event`)
- Presence (`join` / `leave` / `update` / `list`)
- Direct messaging
- Heartbeat / rate limits / max subscriptions
- Yjs adapter at `/yjs/:documentId`

## Setup

```bash
pnpm --filter @rudra/realtime-api start
```

Port: `4004`

```text
ws://host/ws
ws://host/yjs/:documentId
POST /api/v1/realtime/tokens
```
