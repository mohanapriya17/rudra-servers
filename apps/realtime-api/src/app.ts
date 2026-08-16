import type { Express } from "express";
import express from "express";
import cors from "cors";
import { randomUUID, createHmac } from "node:crypto";
import { ZodError } from "zod";
import { createLogger, type Logger } from "@rudra/logging";
import { isRudraError, toErrorBody, RudraError } from "@rudra/errors";
import { createDefaultHttpLimiter } from "@rudra/rate-limit";
import { RealtimeHub } from "./ws/hub.js";
import { YjsAdapter } from "./yjs/adapter.js";

export function createApp(options?: { logger?: Logger }): {
  app: Express;
  logger: Logger;
  hub: RealtimeHub;
  yjs: YjsAdapter;
} {
  const startedAt = Date.now();
  const logger = options?.logger ?? createLogger({ service: "realtime-api" });
  const hub = new RealtimeHub(logger);
  const yjs = new YjsAdapter(logger);
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
      service: "realtime-api",
      version: "0.2.0",
      uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
    });
  });

  app.get("/ready", (_req, res) => {
    res.json({ status: "ready", service: "realtime-api" });
  });

  app.post("/api/v1/realtime/tokens", (req, res) => {
    const identity = String(req.body?.identity ?? `user-${randomUUID().slice(0, 6)}`);
    const secret = process.env.JWT_SECRET ?? "dev-jwt-secret-change-me";
    const payload = Buffer.from(JSON.stringify({ identity, exp: Date.now() + 3_600_000 })).toString(
      "base64url",
    );
    const sig = createHmac("sha256", secret).update(`rt_.${payload}`).digest("base64url");
    res.status(201).json({
      data: {
        token: `rt_.${payload}.${sig}`,
        identity,
        wsPath: "/ws",
        yjsPathPrefix: "/yjs/",
      },
    });
  });

  app.use((req, _res, next) => {
    next(new RudraError("NOT_FOUND", `Route not found: ${req.method} ${req.path}`));
  });

  app.use((error: unknown, req: express.Request, res: express.Response, _next: express.NextFunction) => {
    let normalized = error;
    if (error instanceof ZodError) {
      normalized = new RudraError("VALIDATION_ERROR", "Invalid request", { details: error.flatten() });
    }
    const requestId = (req as express.Request & { requestId?: string }).requestId ?? "unknown";
    const status = isRudraError(normalized) ? normalized.status : 500;
    const reqLogger = (req as express.Request & { logger?: Logger }).logger;
    if (status >= 500) reqLogger?.error("request failed", { status });
    else reqLogger?.warn("request rejected", { status });
    res.status(status).json(toErrorBody(normalized, requestId));
  });

  return { app, logger, hub, yjs };
}
