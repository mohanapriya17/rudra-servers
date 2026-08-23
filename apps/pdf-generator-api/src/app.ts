import type { Express } from "express";
import express from "express";
import cors from "cors";
import { randomUUID } from "node:crypto";
import { ZodError } from "zod";
import { createLogger, type Logger } from "@rudra/logging";
import { isRudraError, toErrorBody, RudraError } from "@rudra/errors";
import { createDefaultHttpLimiter, MemoryRateLimiter } from "@rudra/rate-limit";
import {
  createFirebaseAuthVerifier,
  createTestAuthVerifier,
  type AuthVerifier,
} from "./auth/firebase.js";
import { createPdfRouter } from "./routes/v1.js";

export function createApp(options?: {
  logger?: Logger;
  auth?: AuthVerifier;
  jobLimiter?: MemoryRateLimiter;
}): { app: Express; logger: Logger; auth: AuthVerifier } {
  const startedAt = Date.now();
  const logger = options?.logger ?? createLogger({ service: "pdf-generator-api" });

  let auth = options?.auth;
  if (!auth) {
    if (process.env.PDF_GENERATOR_AUTH_MODE === "test") {
      auth = createTestAuthVerifier();
      logger.warn("PDF_GENERATOR_AUTH_MODE=test; using test Bearer tokens (test:<uid>)");
    } else {
      auth = createFirebaseAuthVerifier();
      logger.info("Firebase auth verifier enabled");
    }
  }

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
      service: "pdf-generator-api",
      version: "0.1.0",
      uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
    });
  });

  app.get("/ready", (_req, res) => {
    res.json({ status: "ready", service: "pdf-generator-api" });
  });

  app.use(
    "/api/v1/pdf",
    createPdfRouter({
      auth,
      jobLimiter: options?.jobLimiter,
    }),
  );

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
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: string }).code === "LIMIT_FILE_SIZE"
    ) {
      normalized = new RudraError("VALIDATION_ERROR", "Uploaded file too large (max 5MB)");
    }

    const requestId = (req as express.Request & { requestId?: string }).requestId ?? "unknown";
    const status = isRudraError(normalized) ? normalized.status : 500;
    const reqLogger = (req as express.Request & { logger?: Logger }).logger;
    if (status >= 500) reqLogger?.error("request failed", { status });
    else reqLogger?.warn("request rejected", { status });
    res.status(status).json(toErrorBody(normalized, requestId));
  });

  return { app, logger, auth };
}
