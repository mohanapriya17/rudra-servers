import type { Express } from "express";
import express from "express";
import cors from "cors";
import { randomBytes, randomUUID } from "node:crypto";
import { createLogger, type Logger } from "@rudra/logging";
import { isRudraError, toErrorBody, RudraError } from "@rudra/errors";
import { createDefaultHttpLimiter } from "@rudra/rate-limit";
import { z } from "zod";
import { buildIceServers } from "./turn.js";

interface Peer {
  id: string;
  name: string;
  joinedAt: string;
  capabilities: {
    audio: boolean;
    video: boolean;
    screen: boolean;
    data: boolean;
  };
}

interface Room {
  id: string;
  token: string;
  peers: Map<string, Peer>;
  createdAt: string;
}

const rooms = new Map<string, Room>();

export function getRooms(): Map<string, Room> {
  return rooms;
}

function iceServersForRequest() {
  return buildIceServers({
    turnUrl: process.env.TURN_URL,
    turnSecret: process.env.TURN_SECRET,
    turnUsername: process.env.TURN_USERNAME,
  });
}

export function createApp(options?: { logger?: Logger }): { app: Express; logger: Logger } {
  const startedAt = Date.now();
  const logger = options?.logger ?? createLogger({ service: "webrtc-api" });
  const app = express();
  const limiter = createDefaultHttpLimiter();

  app.disable("x-powered-by");
  app.use(cors());
  app.use(express.json({ limit: "1mb" }));

  app.use((req, _res, next) => {
    const requestId = (req.header("x-request-id") as string | undefined) ?? randomUUID();
    (req as express.Request & { requestId: string }).requestId = requestId;
    (req as express.Request & { logger: Logger }).logger = logger.child({
      requestId,
      method: req.method,
      path: req.path,
    });
    next();
  });

  app.use((req, _res, next) => {
    try {
      limiter.consume(`${req.ip}:${req.method}:${req.path}`);
      next();
    } catch (error) {
      next(error);
    }
  });

  app.get("/health", (_req, res) => {
    res.json({
      status: "ok",
      service: "webrtc-api",
      version: "0.2.0",
      uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
    });
  });

  app.get("/ready", (_req, res) => {
    res.json({ status: "ready", service: "webrtc-api" });
  });

  app.post("/api/v1/webrtc/rooms", (_req, res) => {
    const roomId = randomBytes(6).toString("hex");
    const token = randomBytes(16).toString("base64url");
    rooms.set(roomId, {
      id: roomId,
      token,
      peers: new Map(),
      createdAt: new Date().toISOString(),
    });
    res.status(201).json({
      data: {
        roomId,
        token,
        iceServers: iceServersForRequest(),
        media: { audio: true, video: true, screen: true, dataChannels: true },
      },
    });
  });

  app.post("/api/v1/webrtc/rooms/:roomId/join", (req, res, next) => {
    try {
      const body = z
        .object({
          name: z.string().min(1).max(40).optional(),
          token: z.string().min(1),
          capabilities: z
            .object({
              audio: z.boolean().optional(),
              video: z.boolean().optional(),
              screen: z.boolean().optional(),
              data: z.boolean().optional(),
            })
            .optional(),
        })
        .parse(req.body);
      const room = rooms.get(req.params.roomId!);
      if (!room || room.token !== body.token) {
        throw new RudraError("NOT_FOUND", "Room not found or invalid token");
      }
      if (room.peers.size >= 2) {
        throw new RudraError("CONFLICT", "Room is full (max 2 peers for P2P)");
      }
      const peerId = randomUUID();
      const peer: Peer = {
        id: peerId,
        name: body.name ?? `peer-${peerId.slice(0, 4)}`,
        joinedAt: new Date().toISOString(),
        capabilities: {
          audio: body.capabilities?.audio ?? true,
          video: body.capabilities?.video ?? true,
          screen: body.capabilities?.screen ?? true,
          data: body.capabilities?.data ?? true,
        },
      };
      room.peers.set(peerId, peer);
      res.status(201).json({
        data: {
          roomId: room.id,
          peerId,
          name: peer.name,
          capabilities: peer.capabilities,
          peers: [...room.peers.values()]
            .filter((p) => p.id !== peerId)
            .map(({ id, name, capabilities }) => ({ id, name, capabilities })),
          signalingPath: "/ws",
          iceServers: iceServersForRequest(),
        },
      });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/v1/webrtc/turn-credentials", (_req, res, next) => {
    try {
      if (!process.env.TURN_SECRET || !process.env.TURN_URL) {
        throw new RudraError("SERVICE_UNAVAILABLE", "TURN is not configured");
      }
      res.json({ data: { iceServers: iceServersForRequest() } });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/v1/webrtc/rooms/:roomId", (req, res, next) => {
    try {
      const room = rooms.get(req.params.roomId!);
      if (!room) throw new RudraError("NOT_FOUND", "Room not found");
      res.json({
        data: {
          roomId: room.id,
          peerCount: room.peers.size,
          createdAt: room.createdAt,
        },
      });
    } catch (error) {
      next(error);
    }
  });

  return { app, logger };
}

export function mountErrorHandlers(app: Express): void {
  app.use((req, _res, next) => {
    next(new RudraError("NOT_FOUND", `Route not found: ${req.method} ${req.path}`));
  });

  app.use((error: unknown, req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const requestId = (req as express.Request & { requestId?: string }).requestId ?? "unknown";
    const status = isRudraError(error) ? error.status : 500;
    const reqLogger = (req as express.Request & { logger?: Logger }).logger;
    if (status >= 500) reqLogger?.error("request failed", { status });
    else reqLogger?.warn("request rejected", { status });
    res.status(status).json(toErrorBody(error, requestId));
  });
}
