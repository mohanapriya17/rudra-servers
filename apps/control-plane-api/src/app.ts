import type { Express } from "express";
import express from "express";
import cors from "cors";
import { randomUUID } from "node:crypto";
import { ZodError } from "zod";
import { createLogger, type Logger } from "@rudra/logging";
import { isRudraError, toErrorBody, RudraError } from "@rudra/errors";
import { createDefaultHttpLimiter } from "@rudra/rate-limit";
import type { ControlPlaneStore } from "./store/memory.js";
import { createControlPlaneRouter } from "./routes/v1.js";

export function createApp(options: {
  store: ControlPlaneStore;
  logger?: Logger;
}): { app: Express; logger: Logger } {
  const startedAt = Date.now();
  const logger = options.logger ?? createLogger({ service: "control-plane-api" });
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
      service: "control-plane-api",
      version: "0.1.0",
      uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
    });
  });

  app.get("/ready", (_req, res) => {
    res.json({ status: "ready", service: "control-plane-api" });
  });

  app.use("/api/v1", createControlPlaneRouter(options.store));

  app.use((req, _res, next) => {
    next(new RudraError("NOT_FOUND", `Route not found: ${req.method} ${req.path}`));
  });

  app.use((error: unknown, req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const requestId = (req as express.Request & { requestId?: string }).requestId ?? "unknown";
    let normalized = error;
    if (error instanceof ZodError) {
      normalized = new RudraError("VALIDATION_ERROR", "Invalid request", {
        details: error.flatten(),
      });
    }
    const status = isRudraError(normalized) ? normalized.status : 500;
    const reqLogger = (req as express.Request & { logger?: Logger }).logger;
    if (status >= 500) reqLogger?.error("request failed", { status });
    else reqLogger?.warn("request rejected", { status });
    res.status(status).json(toErrorBody(normalized, requestId));
  });

  return { app, logger };
}
