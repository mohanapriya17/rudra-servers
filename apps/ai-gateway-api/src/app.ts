import express, { type Express } from "express";
import { randomUUID } from "node:crypto";
import { createLogger, type Logger } from "@rudra/logging";
import { MemoryAssistantStore } from "./assistants/store.js";
import { ChatService } from "./chat/service.js";
import { loadGatewayConfig, type GatewayConfig } from "./config.js";
import { GatewayHttpError } from "./errors.js";
import { GatewayMetrics } from "./observability/metrics.js";
import { createV1Router, gatewayErrorHandler } from "./routes/v1.js";

export interface GatewayAppOptions {
  config?: GatewayConfig;
  logger?: Logger;
  metrics?: GatewayMetrics;
  store?: MemoryAssistantStore;
}

export function createGatewayApp(options: GatewayAppOptions = {}): {
  app: Express;
  config: GatewayConfig;
  logger: Logger;
  metrics: GatewayMetrics;
} {
  const startedAt = Date.now();
  const config = options.config ?? loadGatewayConfig();
  const logger = options.logger ?? createLogger({ service: "ai-gateway-api", level: config.LOG_LEVEL });
  const metrics = options.metrics ?? new GatewayMetrics();
  const store = options.store ?? new MemoryAssistantStore();
  const chat = new ChatService({ config, store, metrics, logger });

  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: config.AI_MAX_REQUEST_BYTES }));

  app.use((req, res, next) => {
    if (req.header("origin")) {
      next(new GatewayHttpError("FORBIDDEN", "Browser-origin requests are not allowed.", 403));
      return;
    }
    next();
  });

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

  const healthPayload = () => ({
    status: "ok",
    service: "ai-gateway-api",
    version: "0.1.0",
    uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
  });

  app.get("/health", (_req, res) => {
    res.json(healthPayload());
  });
  app.get("/health/live", (_req, res) => {
    res.json({ status: "live", service: "ai-gateway-api" });
  });
  app.get("/health/ready", (_req, res) => {
    const checks = {
      signingSecretConfigured: Boolean(config.RUDRA_AI_GATEWAY_SIGNING_SECRET),
      audienceConfigured: Boolean(config.RUDRA_AI_GATEWAY_AUDIENCE),
      openaiConfigured: Boolean(config.OPENAI_API_KEY),
      geminiConfigured: Boolean(config.GEMINI_API_KEY),
    };
    const ready = checks.signingSecretConfigured && checks.audienceConfigured;
    res.status(ready ? 200 : 503).json({
      status: ready ? "ready" : "not_ready",
      service: "ai-gateway-api",
      checks,
    });
  });
  app.get("/ready", (_req, res) => {
    res.json({ status: "ready", service: "ai-gateway-api" });
  });
  app.get("/metrics", (_req, res) => {
    res.json({ service: "ai-gateway-api", metrics: metrics.snapshot() });
  });

  app.use("/v1", createV1Router({ config, chat, logger }));

  app.use((req, _res, next) => {
    next(new GatewayHttpError("INVALID_REQUEST", `Route not found: ${req.method} ${req.path}`, 404));
  });

  app.use(gatewayErrorHandler);

  return { app, config, logger, metrics };
}
