import type { Express } from "express";
import express from "express";
import cors from "cors";
import { randomUUID } from "node:crypto";
import { ZodError } from "zod";
import { createLogger, type Logger } from "@rudra/logging";
import { isRudraError, toErrorBody, RudraError } from "@rudra/errors";
import { createDefaultHttpLimiter } from "@rudra/rate-limit";
import { createR2Provider } from "@rudra/storage-driver";
import { FileStore, MemoryStorageProvider } from "./store/files.js";
import { createFileRouter } from "./routes/v1.js";

export function createApp(options?: {
  logger?: Logger;
  store?: FileStore;
}): { app: Express; logger: Logger; store: FileStore } {
  const startedAt = Date.now();
  const logger = options?.logger ?? createLogger({ service: "file-api" });

  let store = options?.store;
  if (!store) {
    if (process.env.S3_ACCESS_KEY_ID && process.env.S3_SECRET_ACCESS_KEY && process.env.S3_BUCKET) {
      const provider = createR2Provider({
        endpoint: process.env.S3_ENDPOINT,
        region: process.env.S3_REGION ?? "auto",
        accessKeyId: process.env.S3_ACCESS_KEY_ID,
        secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
        bucket: process.env.S3_BUCKET,
        forcePathStyle: true,
      });
      store = new FileStore(provider, process.env.S3_ENDPOINT ? "s3-compatible" : "r2", process.env.S3_BUCKET);
      logger.info("using S3-compatible storage provider");
    } else {
      store = new FileStore(new MemoryStorageProvider(), "memory", "rudra-files");
      logger.warn("S3 credentials not set; using in-memory storage provider");
    }
  }

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
      service: "file-api",
      version: "0.2.0",
      uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
    });
  });

  app.get("/ready", (_req, res) => {
    res.json({ status: "ready", service: "file-api" });
  });

  app.use("/api/v1/files", createFileRouter(store));

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

  return { app, logger, store };
}
