import { WebSocketServer, WebSocket } from "ws";
import type { Server } from "node:http";
import { getRooms } from "./app.js";
import type { Logger } from "@rudra/logging";

interface SocketState {
  roomId?: string;
  peerId?: string;
}

export function attachSignaling(server: Server, logger: Logger): WebSocketServer {
  const wss = new WebSocketServer({ server, path: "/ws" });
  const sockets = new Map<WebSocket, SocketState>();

  wss.on("connection", (socket) => {
    sockets.set(socket, {});

    socket.on("message", (raw) => {
      let message: Record<string, unknown>;
      try {
        message = JSON.parse(String(raw)) as Record<string, unknown>;
      } catch {
        socket.send(JSON.stringify({ type: "error", message: "Invalid JSON" }));
        return;
      }

      const state = sockets.get(socket) ?? {};
      const type = message.type;

      if (type === "join") {
        const roomId = String(message.roomId ?? "");
        const peerId = String(message.peerId ?? "");
        const room = getRooms().get(roomId);
        if (!room || !room.peers.has(peerId)) {
          socket.send(JSON.stringify({ type: "error", message: "Unauthorized room join" }));
          return;
        }
        state.roomId = roomId;
        state.peerId = peerId;
        sockets.set(socket, state);
        for (const [peerSocket, peerState] of sockets) {
          if (peerSocket !== socket && peerState.roomId === roomId && peerSocket.readyState === WebSocket.OPEN) {
            peerSocket.send(
              JSON.stringify({
                type: "peer-joined",
                peerId,
                name: room.peers.get(peerId)?.name,
              }),
            );
          }
        }
        socket.send(JSON.stringify({ type: "joined", roomId, peerId }));
        return;
      }

      if (!state.roomId || !state.peerId) {
        socket.send(JSON.stringify({ type: "error", message: "Join a room first" }));
        return;
      }

      if (type === "offer" || type === "answer" || type === "ice-candidate") {
        const target = String(message.target ?? "");
        for (const [peerSocket, peerState] of sockets) {
          if (peerState.roomId === state.roomId && peerState.peerId === target && peerSocket.readyState === WebSocket.OPEN) {
            peerSocket.send(
              JSON.stringify({
                type,
                from: state.peerId,
                sdp: message.sdp,
                candidate: message.candidate,
              }),
            );
          }
        }
        return;
      }

      if (type === "ping") {
        socket.send(JSON.stringify({ type: "pong", t: Date.now() }));
      }
    });

    socket.on("close", () => {
      const state = sockets.get(socket);
      sockets.delete(socket);
      if (!state?.roomId || !state.peerId) return;
      const room = getRooms().get(state.roomId);
      room?.peers.delete(state.peerId);
      for (const [peerSocket, peerState] of sockets) {
        if (peerState.roomId === state.roomId && peerSocket.readyState === WebSocket.OPEN) {
          peerSocket.send(JSON.stringify({ type: "peer-left", peerId: state.peerId }));
        }
      }
      if (room && room.peers.size === 0) getRooms().delete(state.roomId);
      logger.info("peer disconnected", { roomId: state.roomId, peerId: state.peerId });
    });
  });

  return wss;
}
