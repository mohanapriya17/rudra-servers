import { Router } from "express";
import { functionCreateSchema, functionInvokeSchema } from "@rudra/contracts";
import {
  buildFunctionContext,
  FunctionStore,
  invokeTrustedFunction,
} from "../runtime/executor.js";

function data<T>(value: T) {
  return { data: value };
}

export function createFunctionRouter(store: FunctionStore): Router {
  const router = Router();

  router.post("/", (req, res, next) => {
    try {
      const body = functionCreateSchema.parse(req.body);
      const created = store.create({
        name: body.name,
        description: body.description,
        runtime: body.runtime,
        code: body.code,
        timeoutMs: body.timeoutMs,
        triggers: body.triggers,
        secrets: body.secrets,
      });
      res.status(201).json(data(created));
    } catch (error) {
      next(error);
    }
  });

  router.get("/", (_req, res) => {
    res.json(
      data(
        store.list().map(({ code: _code, ...rest }) => rest),
      ),
    );
  });

  router.get("/:functionId", (req, res, next) => {
    try {
      const fn = store.get(req.params.functionId!);
      const { code: _code, ...rest } = fn;
      res.json(data(rest));
    } catch (error) {
      next(error);
    }
  });

  router.post("/:functionId/invoke", async (req, res, next) => {
    try {
      const body = functionInvokeSchema.parse(req.body ?? {});
      const fn = store.get(req.params.functionId!);
      if (!fn.triggers.includes("http") && !fn.triggers.includes("manual")) {
        // still allow explicit invoke for admin
      }
      const secrets: Record<string, string> = {};
      for (const name of fn.secrets) {
        const value = process.env[`SECRET_${name}`] ?? process.env[name];
        if (value) secrets[name] = value;
      }
      const ctx = buildFunctionContext({
        input: body.input,
        secrets,
        postgresApiUrl: process.env.POSTGRES_API_URL,
        mongoApiUrl: process.env.MONGODB_API_URL,
        fileApiUrl: process.env.FILE_API_URL,
      });
      const result = await invokeTrustedFunction(fn, ctx);
      res.json(data(result));
    } catch (error) {
      next(error);
    }
  });

  router.post("/:functionId/webhook", async (req, res, next) => {
    try {
      const fn = store.get(req.params.functionId!);
      if (!fn.triggers.includes("webhook") && !fn.triggers.includes("http")) {
        res.status(405).json({
          error: {
            code: "UNSUPPORTED_OPERATION",
            message: "Webhook trigger not enabled",
            requestId: (req as { requestId?: string }).requestId ?? "unknown",
          },
        });
        return;
      }
      const secrets: Record<string, string> = {};
      for (const name of fn.secrets) {
        const value = process.env[`SECRET_${name}`] ?? process.env[name];
        if (value) secrets[name] = value;
      }
      const ctx = buildFunctionContext({
        input: {
          headers: req.headers,
          body: req.body,
          query: req.query,
        },
        secrets,
        postgresApiUrl: process.env.POSTGRES_API_URL,
        mongoApiUrl: process.env.MONGODB_API_URL,
        fileApiUrl: process.env.FILE_API_URL,
      });
      const result = await invokeTrustedFunction(fn, ctx);
      res.json(data(result));
    } catch (error) {
      next(error);
    }
  });

  return router;
}
