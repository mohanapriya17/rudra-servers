# WebRTC Signaling API

Signaling, rooms, peer discovery, and ICE exchange for browser P2P audio/video.

Does **not** implement an SFU. Media stays peer-to-peer. TURN can be configured separately (e.g. Coturn).

## Endpoints

```http
POST /api/v1/webrtc/rooms
POST /api/v1/webrtc/rooms/:roomId/join
GET  /api/v1/webrtc/rooms/:roomId
WS   /ws
```

Signaling message types: `join`, `offer`, `answer`, `ice-candidate`, `peer-joined`, `peer-left`, `ping`/`pong`.

## Setup

```bash
pnpm --filter @rudra/webrtc-api start
```

Default port: `4005`
