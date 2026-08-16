import type { Express } from "express";
import express from "express";
import cors from "cors";
import { randomUUID } from "node:crypto";
import { ZodError } from "zod";
import { createLogger, type Logger } from "@rudra/logging";
import { isRudraError, toErrorBody, RudraError } from "@rudra/errors";
import { createDefaultHttpLimiter } from "@rudra/rate-limit";
import { MongoRegistry } from "./registry.js";
import { ClientManager } from "./client-manager.js";
import { createMongoRouter } from "./routes/v1.js";

export function createApp(options?: {
  logger?: Logger;
  registry?: MongoRegistry;
  clients?: ClientManager;
}): {
  app: Express;
  logger: Logger;
  registry: MongoRegistry;
  clients: ClientManager;
} {
  const startedAt = Date.now();
  const logger = options?.logger ?? createLogger({ service: "mongodb-api" });
  const registry = options?.registry ?? new MongoRegistry();
  const clients = options?.clients ?? new ClientManager(registry);
  const app = express();
  const limiter = createDefaultHttpLimiter();

  app.disable("x-powered-by");
  app.use(cors());
  app.use(express.json({ limit: "2mb" }));

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
      service: "mongodb-api",
      version: "0.2.0",
      uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
    });
  });

  app.get("/ready", (_req, res) => {
    res.json({ status: "ready", service: "mongodb-api" });
  });

  app.use("/api/v1/mongodb", createMongoRouter(registry, clients));

  app.use((req, _res, next) => {
    next(new RudraError("NOT_FOUND", `Route not found: ${req.method} ${req.path}`));
  });

  app.use((error: unknown, req: express.Request, res: express.Response, _next: express.NextFunction) => {
    let normalized = error;
    if (error instanceof ZodError) {
      normalized = new RudraError("VALIDATION_ERROR", "Invalid request", {
        details: error.flatten(),
      });
    }
    // Mongo duplicate key
    if (
      typeof error === "object" &&
      error &&
      "code" in error &&
      (error as { code?: number }).code === 11000
    ) {
      normalized = new RudraError("CONFLICT", "Duplicate key violation");
    }
    // Mongo validation failure
    if (
      typeof error === "object" &&
      error &&
      "code" in error &&
      ((error as { code?: number }).code === 121 || (error as { code?: number }).code === 21)
    ) {
      normalized = new RudraError("VALIDATION_ERROR", "Document failed schema validation");
    }

    const requestId = (req as express.Request & { requestId?: string }).requestId ?? "unknown";
    const status = isRudraError(normalized) ? normalized.status : 500;
    const reqLogger = (req as express.Request & { logger?: Logger }).logger;
    if (status >= 500) {
      reqLogger?.error("request failed", {
        status,
        err: error instanceof Error ? error.message : String(error),
      });
    } else {
      reqLogger?.warn("request rejected", { status });
    }
    res.status(status).json(toErrorBody(normalized, requestId));
  });

  return { app, logger, registry, clients };
}

export function mountErrorHandlers(_app: Express): void {
  // compatibility no-op; errors mounted in createApp
}
