import { Router } from "express";
import { graphql } from "graphql";
import {
  graphqlCreateSchemaSchema,
  graphqlFieldSchema,
  graphqlTypeSchema,
} from "@rudra/contracts";
import { z } from "zod";
import { RudraError } from "@rudra/errors";
import type { GraphQLRegistry } from "../registry.js";
import { buildExecutableSchema, createRequestContext } from "../schema/build.js";
import type { ResolverContext } from "../resolvers/execute.js";

function data<T>(value: T) {
  return { data: value };
}

export function createGraphqlRouter(
  registry: GraphQLRegistry,
  contextDefaults: Omit<ResolverContext, "loaders" | "complexity" | "requestId">,
): Router {
  const router = Router();

  router.post("/schemas", (req, res, next) => {
    try {
      const body = graphqlCreateSchemaSchema.parse(req.body);
      res.status(201).json(data(registry.create(body)));
    } catch (error) {
      next(error);
    }
  });

  router.get("/schemas", (_req, res) => {
    res.json(data(registry.list()));
  });

  router.get("/schemas/:schemaId", (req, res, next) => {
    try {
      res.json(data(registry.get(req.params.schemaId!)));
    } catch (error) {
      next(error);
    }
  });

  router.post("/schemas/:schemaId/types", (req, res, next) => {
    try {
      const body = graphqlTypeSchema.parse(req.body);
      res.status(201).json(data(registry.addType(req.params.schemaId!, body)));
    } catch (error) {
      next(error);
    }
  });

  router.put("/schemas/:schemaId/queries", (req, res, next) => {
    try {
      const body = z.array(graphqlFieldSchema).parse(req.body);
      res.json(data(registry.setQueries(req.params.schemaId!, body)));
    } catch (error) {
      next(error);
    }
  });

  router.put("/schemas/:schemaId/mutations", (req, res, next) => {
    try {
      const body = z.array(graphqlFieldSchema).parse(req.body);
      res.json(data(registry.setMutations(req.params.schemaId!, body)));
    } catch (error) {
      next(error);
    }
  });

  router.post("/schemas/:schemaId/graphql", async (req, res, next) => {
    try {
      const config = registry.get(req.params.schemaId!);
      const executable = buildExecutableSchema(config, () =>
        createRequestContext({
          ...contextDefaults,
          requestId: (req as { requestId?: string }).requestId ?? "unknown",
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
          requestId: (req as { requestId?: string }).requestId ?? "unknown",
        }),
      });
      res.status(result.errors?.length ? 400 : 200).json(result);
    } catch (error) {
      next(error);
    }
  });

  return router;
}
