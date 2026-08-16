import type { Express } from "express";
import express from "express";
import cors from "cors";
import { randomUUID } from "node:crypto";
import { ZodError } from "zod";
import { graphql } from "graphql";
import { createLogger, type Logger } from "@rudra/logging";
import { isRudraError, toErrorBody, RudraError } from "@rudra/errors";
import { createDefaultHttpLimiter } from "@rudra/rate-limit";
import { GraphQLRegistry } from "./registry.js";
import { createGraphqlRouter } from "./routes/v1.js";
import { buildExecutableSchema, createRequestContext } from "./schema/build.js";
import type { ResolverContext } from "./resolvers/execute.js";

export function createApp(options?: {
  logger?: Logger;
  registry?: GraphQLRegistry;
  contextDefaults?: Partial<Omit<ResolverContext, "loaders" | "complexity" | "requestId">>;
}): { app: Express; logger: Logger; registry: GraphQLRegistry } {
  const startedAt = Date.now();
  const logger = options?.logger ?? createLogger({ service: "graphql-api" });
  const registry = options?.registry ?? new GraphQLRegistry();
  const contextDefaults: Omit<ResolverContext, "loaders" | "complexity" | "requestId"> = {
    postgresEndpoints: options?.contextDefaults?.postgresEndpoints ?? new Map(),
    mongoEndpoints: options?.contextDefaults?.mongoEndpoints ?? new Map(),
    functionEndpoint: options?.contextDefaults?.functionEndpoint,
    allowedRestHosts: options?.contextDefaults?.allowedRestHosts ?? new Set(["*"]),
    fetchImpl: options?.contextDefaults?.fetchImpl ?? fetch,
    secrets: options?.contextDefaults?.secrets ?? {},
  };

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
      service: "graphql-api",
      version: "0.2.0",
      uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
    });
  });

  app.get("/ready", (_req, res) => {
    res.json({ status: "ready", service: "graphql-api" });
  });

  app.use("/api/v1/graphql", createGraphqlRouter(registry, contextDefaults));

  // Default GraphQL endpoint uses the first schema when present
  app.post("/graphql", async (req, res, next) => {
    try {
      const schemas = registry.list();
      const schemaName = typeof req.query.schema === "string" ? req.query.schema : schemas[0]?.name;
      if (!schemaName) throw new RudraError("NOT_FOUND", "No GraphQL schema configured");
      const config = registry.get(schemaName);
      const executable = buildExecutableSchema(config, () =>
        createRequestContext({
          ...contextDefaults,
          requestId: (req as express.Request & { requestId?: string }).requestId ?? "unknown",
        }),
      );
      const query = String(req.body?.query ?? "");
      if (!query) throw new RudraError("VALIDATION_ERROR", "query is required");
      if (!config.introspection && /\b__schema\b|\b__type\b/.test(query)) {
        throw new RudraError("FORBIDDEN", "Introspection disabled");
      }
      const result = await graphql({
        schema: executable,
        source: query,
        variableValues: req.body?.variables,
        operationName: req.body?.operationName,
        contextValue: createRequestContext({
          ...contextDefaults,
          requestId: (req as express.Request & { requestId?: string }).requestId ?? "unknown",
        }),
      });
      res.status(result.errors?.length ? 400 : 200).json(result);
    } catch (error) {
      next(error);
    }
  });

  app.get("/graphql", (_req, res) => {
    res.type("html").send(`<!doctype html><title>Rudra GraphQL</title><p>POST GraphQL queries to <code>/graphql</code>.</p>`);
  });

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
    const requestId = (req as express.Request & { requestId?: string }).requestId ?? "unknown";
    const status = isRudraError(normalized) ? normalized.status : 500;
    const reqLogger = (req as express.Request & { logger?: Logger }).logger;
    if (status >= 500) reqLogger?.error("request failed", { status });
    else reqLogger?.warn("request rejected", { status });
    res.status(status).json(toErrorBody(normalized, requestId));
  });

  return { app, logger, registry };
}
