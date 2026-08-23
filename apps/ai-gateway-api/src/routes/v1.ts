import { randomUUID } from "node:crypto";
import { Router, type NextFunction, type Request, type Response } from "express";
import { ZodError } from "zod";
import { FeedbackRequestSchema } from "@rudra/ai-contracts";
import type { Logger } from "@rudra/logging";
import { parseBearer, verifyServiceToken } from "../auth/jwt.js";
import type { ChatService } from "../chat/service.js";
import type { GatewayConfig } from "../config.js";
import { GatewayHttpError, toGatewayErrorBody } from "../errors.js";

export interface V1RouterOptions {
  config: GatewayConfig;
  chat: ChatService;
  logger?: Logger;
}

export function createV1Router(options: V1RouterOptions): Router {
  const router = Router();

  router.use((req, res, next) => {
    const requestId = req.header("x-request-id") ?? randomUUID();
    (req as Request & { requestId: string }).requestId = requestId;
    res.setHeader("x-request-id", requestId);
    next();
  });

  router.use((req, res, next) => {
    try {
      const token = parseBearer(req.header("authorization"));
      if (!token) {
        throw new GatewayHttpError("UNAUTHENTICATED", "Missing bearer token.", 401);
      }
      const claims = verifyServiceToken(token, options.config.RUDRA_AI_GATEWAY_SIGNING_SECRET, {
        issuer: options.config.RUDRA_AI_GATEWAY_ISSUER,
        audience: options.config.RUDRA_AI_GATEWAY_AUDIENCE,
      });
      (req as Request & { claims: typeof claims }).claims = claims;
      next();
    } catch (error) {
      next(error);
    }
  });

  router.post("/chat", async (req, res, next) => {
    try {
      const claims = (req as Request & { claims: ReturnType<typeof verifyServiceToken> }).claims;
      const response = await options.chat.complete(req.body, claims);
      res.json(response);
    } catch (error) {
      next(error);
    }
  });

  router.post("/chat/stream", async (req, res, next) => {
    const requestId = (req as Request & { requestId: string }).requestId;
    const claims = (req as Request & { claims?: ReturnType<typeof verifyServiceToken> }).claims;
    if (!claims) {
      next(new GatewayHttpError("UNAUTHENTICATED", "Missing bearer token.", 401));
      return;
    }

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders?.();

    try {
      for await (const event of options.chat.stream(req.body, claims)) {
        res.write(`event: ${event.event}\n`);
        res.write(`data: ${JSON.stringify(event)}\n\n`);
      }
      res.end();
    } catch (error) {
      const body = toGatewayErrorBody(error, requestId);
      const conversationId =
        typeof req.body === "object" && req.body && "conversationId" in req.body
          ? String((req.body as { conversationId?: string }).conversationId ?? "")
          : "";
      const errorEvent = {
        event: "response.error" as const,
        version: 1 as const,
        requestId,
        conversationId,
        error: body.error,
      };
      res.write(`event: response.error\n`);
      res.write(`data: ${JSON.stringify(errorEvent)}\n\n`);
      res.end();
    }
  });

  router.post("/feedback", async (req, res, next) => {
    try {
      const claims = (req as Request & { claims: ReturnType<typeof verifyServiceToken> }).claims;
      const parsed = FeedbackRequestSchema.parse(req.body);
      options.chat.recordFeedback(parsed, claims);
      res.status(202).json({ version: 1, accepted: true });
    } catch (error) {
      next(error);
    }
  });

  return router;
}

export function gatewayErrorHandler(
  error: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  const requestId = (req as Request & { requestId?: string }).requestId ?? "unknown";
  if (error instanceof ZodError) {
    res.status(400).json(
      toGatewayErrorBody(new GatewayHttpError("INVALID_REQUEST", "Invalid request.", 400), requestId),
    );
    return;
  }
  const body = toGatewayErrorBody(error, requestId);
  const status = error instanceof GatewayHttpError ? error.status : 500;
  res.status(status).json(body);
}
