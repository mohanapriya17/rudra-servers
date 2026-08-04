# Rudra WebRTC Server

Signaling server and web client for **1:1 video and audio calls** over WebRTC.

Media streams go peer-to-peer. This server only handles signaling (room join, SDP, ICE candidates) via Socket.IO.

## Features

- Room-based 1:1 calls (max 2 peers per room)
- Video or audio-only mode
- Mute mic / toggle camera / leave call
- Perfect negotiation (handles offer glare)
- Public Google STUN servers for NAT traversal
- Health and room list HTTP endpoints

## Quick start

```bash
npm install
npm start
```

Open [http://localhost:3000](http://localhost:3000) in two browsers (or one normal + one private window).

1. Enter a name and the same room code (e.g. `SUNRISE`)
2. Choose **Video call** or **Audio only**
3. Click **Join room** and allow camera/mic access

## Environment

| Variable       | Default   | Description                          |
|----------------|-----------|--------------------------------------|
| `PORT`         | `3000`    | HTTP / WebSocket port                |
| `HOST`         | `0.0.0.0` | Bind address                         |
| `CORS_ORIGIN`  | `*`       | Socket.IO CORS origin                |

```bash
PORT=8080 npm start
```

## API

### `GET /health`

```json
{ "ok": true, "rooms": 1, "peers": 2 }
```

### `GET /api/rooms`

```json
{ "rooms": [{ "id": "SUNRISE", "peerCount": 1 }] }
```

## Signaling events

| Event          | Direction     | Purpose                                      |
|----------------|---------------|----------------------------------------------|
| `welcome`      | server → client | Your socket id + ICE servers               |
| `join-room`    | client → server | `{ roomId, name }` → ack with peers        |
| `peer-joined`  | server → client | New peer in room                             |
| `peer-left`    | server → client | Peer left                                    |
| `signal`       | both          | SDP descriptions / ICE candidates            |
| `media-state`  | both          | Mute / camera status                         |
| `leave-room`   | client → server | Leave current room                         |

## Project layout

```
src/server.js      Signaling + static file server
public/index.html  Call UI
public/app.js      WebRTC client
public/styles.css  Styles
```

## Notes

- Browsers require **HTTPS** (or `localhost`) for `getUserMedia`.
- For production behind restrictive NATs, add a TURN server to the `iceServers` list in `src/server.js`.
- Rooms are in-memory; they reset when the process restarts.
