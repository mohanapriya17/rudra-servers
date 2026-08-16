import type { Express } from "express";
import express from "express";
import cors from "cors";
import { randomUUID } from "node:crypto";
import { ZodError } from "zod";
import { createLogger, type Logger } from "@rudra/logging";
import { isRudraError, toErrorBody, RudraError } from "@rudra/errors";
import { createDefaultHttpLimiter } from "@rudra/rate-limit";
import { PostgresRegistry } from "./registry.js";
import { PoolManager } from "./pool-manager.js";
import { createPostgresRouter } from "./routes/v1.js";

export function createApp(options?: {
  logger?: Logger;
  registry?: PostgresRegistry;
  pools?: PoolManager;
}): { app: Express; logger: Logger; registry: PostgresRegistry; pools: PoolManager } {
  const startedAt = Date.now();
  const logger = options?.logger ?? createLogger({ service: "postgres-api" });
  const registry = options?.registry ?? new PostgresRegistry();
  const pools = options?.pools ?? new PoolManager(registry);
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
      service: "postgres-api",
      version: "0.2.0",
      uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
    });
  });

  app.get("/ready", (_req, res) => {
    res.json({ status: "ready", service: "postgres-api" });
  });

  app.use("/api/v1/postgres", createPostgresRouter(registry, pools));

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
    // pg unique violation
    if (
      typeof error === "object" &&
      error &&
      "code" in error &&
      (error as { code?: string }).code === "23505"
    ) {
      normalized = new RudraError("CONFLICT", "Unique constraint violation");
    }
    if (
      typeof error === "object" &&
      error &&
      "code" in error &&
      (error as { code?: string }).code === "23503"
    ) {
      normalized = new RudraError("VALIDATION_ERROR", "Foreign key constraint violation");
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

  return { app, logger, registry, pools };
}

export function mountErrorHandlers(_app: Express): void {
  // kept for Phase 0 compatibility; errors are mounted in createApp
}
