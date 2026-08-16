import { WebSocketServer, WebSocket } from "ws";
import type { Server } from "node:http";
import * as Y from "yjs";
import * as syncProtocol from "y-protocols/sync";
import * as awarenessProtocol from "y-protocols/awareness";
import * as encoding from "lib0/encoding";
import * as decoding from "lib0/decoding";
import type { Logger } from "@rudra/logging";

interface DocRoom {
  doc: Y.Doc;
  awareness: awarenessProtocol.Awareness;
  sockets: Set<WebSocket>;
}

/**
 * Yjs adapter on top of the realtime service.
 * Endpoint: /yjs/:documentId
 */
export class YjsAdapter {
  private rooms = new Map<string, DocRoom>();

  constructor(private readonly logger: Logger) {}

  attach(server: Server): WebSocketServer {
    const wss = new WebSocketServer({ noServer: true, maxPayload: 2_000_000 });

    server.on("upgrade", (req, socket, head) => {
      const url = new URL(req.url ?? "", "http://localhost");
      if (!url.pathname.startsWith("/yjs/")) return;
      const documentId = decodeURIComponent(url.pathname.slice("/yjs/".length));
      if (!documentId || documentId.length > 200) {
        socket.destroy();
        return;
      }
      wss.handleUpgrade(req, socket, head, (ws) => {
        this.handleConnection(ws, documentId);
      });
    });

    return wss;
  }

  private getRoom(documentId: string): DocRoom {
    let room = this.rooms.get(documentId);
    if (!room) {
      const doc = new Y.Doc();
      room = {
        doc,
        awareness: new awarenessProtocol.Awareness(doc),
        sockets: new Set(),
      };
      this.rooms.set(documentId, room);
    }
    return room;
  }

  private handleConnection(socket: WebSocket, documentId: string): void {
    const room = this.getRoom(documentId);
    room.sockets.add(socket);
    this.logger.info("yjs connected", { documentId });

    // Send sync step 1
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, 0);
    syncProtocol.writeSyncStep1(encoder, room.doc);
    socket.send(encoding.toUint8Array(encoder));

    socket.on("message", (data) => {
      try {
        const buffer = data instanceof ArrayBuffer ? new Uint8Array(data) : new Uint8Array(data as Buffer);
        const decoder = decoding.createDecoder(buffer);
        const messageType = decoding.readVarUint(decoder);

        if (messageType === 0) {
          const encoderOut = encoding.createEncoder();
          encoding.writeVarUint(encoderOut, 0);
          syncProtocol.readSyncMessage(decoder, encoderOut, room.doc, null);
          const out = encoding.toUint8Array(encoderOut);
          if (out.length > 1) socket.send(out);

          // Broadcast update to peers
          for (const peer of room.sockets) {
            if (peer !== socket && peer.readyState === WebSocket.OPEN) {
              peer.send(buffer);
            }
          }
        } else if (messageType === 1) {
          awarenessProtocol.applyAwarenessUpdate(
            room.awareness,
            decoding.readVarUint8Array(decoder),
            socket,
          );
          for (const peer of room.sockets) {
            if (peer !== socket && peer.readyState === WebSocket.OPEN) {
              peer.send(buffer);
            }
          }
        }
      } catch (error) {
        this.logger.warn("yjs message error", {
          err: error instanceof Error ? error.message : String(error),
        });
      }
    });

    socket.on("close", () => {
      room.sockets.delete(socket);
      awarenessProtocol.removeAwarenessStates(room.awareness, [room.doc.clientID], "disconnect");
      if (room.sockets.size === 0) {
        room.doc.destroy();
        this.rooms.delete(documentId);
      }
    });
  }
}
