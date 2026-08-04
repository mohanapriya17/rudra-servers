const path = require("path");
const http = require("http");
const express = require("express");
const cors = require("cors");
const { Server } = require("socket.io");

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || "0.0.0.0";

/** @typedef {{ id: string, name: string }} Peer */
/** @typedef {{ id: string, peers: Map<string, Peer> }} Room */

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: process.env.CORS_ORIGIN || "*",
    methods: ["GET", "POST"],
  },
});

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "..", "public")));

/** @type {Map<string, Room>} */
const rooms = new Map();

function getOrCreateRoom(roomId) {
  const id = roomId.trim().toUpperCase();
  if (!rooms.has(id)) {
    rooms.set(id, { id, peers: new Map() });
  }
  return rooms.get(id);
}

function serializePeers(room, excludeId) {
  return [...room.peers.values()]
    .filter((peer) => peer.id !== excludeId)
    .map((peer) => ({ id: peer.id, name: peer.name }));
}

function leaveRoom(socket) {
  const roomId = socket.data.roomId;
  if (!roomId) return;

  const room = rooms.get(roomId);
  if (!room) {
    socket.data.roomId = null;
    return;
  }

  room.peers.delete(socket.id);
  socket.leave(roomId);
  socket.to(roomId).emit("peer-left", { id: socket.id });

  if (room.peers.size === 0) {
    rooms.delete(roomId);
  }

  socket.data.roomId = null;
  socket.data.name = null;
}

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    rooms: rooms.size,
    peers: [...rooms.values()].reduce((sum, room) => sum + room.peers.size, 0),
  });
});

app.get("/api/rooms", (_req, res) => {
  res.json({
    rooms: [...rooms.values()].map((room) => ({
      id: room.id,
      peerCount: room.peers.size,
    })),
  });
});

io.on("connection", (socket) => {
  socket.data.roomId = null;
  socket.data.name = null;

  socket.emit("welcome", {
    id: socket.id,
    iceServers: [
      { urls: "stun:stun.l.google.com:19302" },
      { urls: "stun:stun1.l.google.com:19302" },
    ],
  });

  socket.on("join-room", ({ roomId, name }, ack) => {
    try {
      if (!roomId || typeof roomId !== "string") {
        ack?.({ ok: false, error: "Room ID is required" });
        return;
      }

      const normalizedRoom = roomId.trim().toUpperCase();
      const displayName =
        typeof name === "string" && name.trim()
          ? name.trim().slice(0, 40)
          : `Guest-${socket.id.slice(0, 4)}`;

      if (normalizedRoom.length < 2 || normalizedRoom.length > 32) {
        ack?.({ ok: false, error: "Room ID must be 2–32 characters" });
        return;
      }

      if (socket.data.roomId) {
        leaveRoom(socket);
      }

      const room = getOrCreateRoom(normalizedRoom);

      // 1:1 calls — allow at most 2 peers per room
      if (room.peers.size >= 2) {
        ack?.({ ok: false, error: "Room is full (max 2 people)" });
        return;
      }

      room.peers.set(socket.id, { id: socket.id, name: displayName });
      socket.data.roomId = room.id;
      socket.data.name = displayName;
      socket.join(room.id);

      const peers = serializePeers(room, socket.id);

      ack?.({
        ok: true,
        roomId: room.id,
        peerId: socket.id,
        name: displayName,
        peers,
      });

      socket.to(room.id).emit("peer-joined", {
        id: socket.id,
        name: displayName,
      });
    } catch (err) {
      console.error("join-room error:", err);
      ack?.({ ok: false, error: "Failed to join room" });
    }
  });

  socket.on("signal", ({ to, data }) => {
    const roomId = socket.data.roomId;
    if (!roomId || !to || !data) return;

    const room = rooms.get(roomId);
    if (!room || !room.peers.has(to)) return;

    io.to(to).emit("signal", {
      from: socket.id,
      data,
    });
  });

  socket.on("media-state", ({ audio, video }) => {
    const roomId = socket.data.roomId;
    if (!roomId) return;

    socket.to(roomId).emit("media-state", {
      id: socket.id,
      audio: Boolean(audio),
      video: Boolean(video),
    });
  });

  socket.on("leave-room", () => {
    leaveRoom(socket);
  });

  socket.on("disconnect", () => {
    leaveRoom(socket);
  });
});

server.listen(PORT, HOST, () => {
  console.log(`Rudra WebRTC server listening on http://${HOST}:${PORT}`);
});
