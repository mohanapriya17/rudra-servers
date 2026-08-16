# WebRTC Signaling API

P2P signaling for audio, video, screen share, and data channels.

Does **not** implement an SFU.

## Features

- Room create / join with temporary tokens
- WebSocket signaling (`offer` / `answer` / ICE / screen / datachannel)
- STUN by default
- Optional Coturn TURN with time-limited credentials (`TURN_URL`, `TURN_SECRET`)

## Setup

```bash
pnpm --filter @rudra/webrtc-api start
```

Port: `4005`
