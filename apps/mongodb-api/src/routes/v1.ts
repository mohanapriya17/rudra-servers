import { Router } from "express";
import { randomUUID } from "node:crypto";
import { ZodError } from "zod";
import {
  mongoAggregateSchema,
  mongoBulkCreateSchema,
  mongoBulkDeleteSchema,
  mongoBulkUpdateSchema,
  mongoCreateDataSourceSchema,
  mongoCreateIndexSchema,
  mongoCreateResourceSchema,
  mongoQuerySchema,
} from "@rudra/contracts";
import { RudraError } from "@rudra/errors";
import { assertFieldPath } from "@rudra/mongodb-driver";
import type { MongoRegistry } from "../registry.js";
import type { ClientManager } from "../client-manager.js";
import { toPublicDataSource } from "../types.js";
import {
  aggregateDocuments,
  bulkCreate,
  bulkDelete,
  bulkUpdate,
  createDocument,
  createIndex,
  deleteDocument,
  ensureCollection,
  getDocument,
  listDocuments,
  queryDocuments,
  updateDocument,
} from "../data/service.js";

function data<T>(value: T, meta?: Record<string, unknown>) {
  return meta ? { data: value, meta } : { data: value };
}

function parsePagination(query: Record<string, unknown>) {
  const page = Math.max(1, Number(query.page ?? 1) || 1);
  const limit = Math.min(1000, Math.max(1, Number(query.limit ?? 20) || 20));
  const sort = typeof query.sort === "string" ? query.sort : undefined;
  const order = query.order === "desc" ? "desc" : "asc";
  return {
    page,
    limit,
    skip: (page - 1) * limit,
    sort,
    order: order as "asc" | "desc",
  };
}

export function createMongoRouter(registry: MongoRegistry, clients: ClientManager): Router {
  const router = Router();

  router.post("/datasources", async (req, res, next) => {
    try {
      const body = mongoCreateDataSourceSchema.parse(req.body);
      let connectionString = body.connectionString;
      if (!connectionString && body.connectionSecretId) {
        connectionString = process.env[`SECRET_${body.connectionSecretId}`];
        if (!connectionString) {
          throw new RudraError(
            "VALIDATION_ERROR",
            "connectionSecretId could not be resolved; provide connectionString for local setup",
          );
        }
      }
      if (!connectionString) {
        throw new RudraError("VALIDATION_ERROR", "connectionString is required");
      }

      const ds = registry.createDataSource({
        name: body.name,
        connectionString,
        database: body.database,
        applicationId: body.applicationId,
        environmentId: body.environmentId,
        connectionSecretId: body.connectionSecretId,
      });
      await clients.getDb(ds.id);
      res.status(201).json(data(toPublicDataSource(ds)));
    } catch (error) {
      next(error);
    }
  });

  router.get("/datasources", (_req, res) => {
    res.json(data(registry.listDataSources().map(toPublicDataSource)));
  });

  router.get("/datasources/:source", (req, res, next) => {
    try {
      res.json(data(toPublicDataSource(registry.resolveDataSource(req.params.source!))));
    } catch (error) {
      next(error);
    }
  });

  router.post("/:source/resources", async (req, res, next) => {
    try {
      const body = mongoCreateResourceSchema.parse(req.body);
      const ds = registry.resolveDataSource(req.params.source!);
      const resource = registry.createResource({
        dataSourceId: ds.id,
        name: body.name,
        schema: body.schema as never,
        validationLevel: body.validationLevel,
        validationAction: body.validationAction,
      });
      const db = await clients.getDb(ds.id);
      await ensureCollection(db, resource);
      res.status(201).json(data(resource));
    } catch (error) {
      next(error);
    }
  });

  router.get("/:source/resources", (req, res, next) => {
    try {
      const ds = registry.resolveDataSource(req.params.source!);
      res.json(data(registry.listResources(ds.id)));
    } catch (error) {
      next(error);
    }
  });

  router.get("/:source/resources/:resource", (req, res, next) => {
    try {
      const ds = registry.resolveDataSource(req.params.source!);
      res.json(data(registry.resolveResource(ds.id, req.params.resource!)));
    } catch (error) {
      next(error);
    }
  });

  router.put("/:source/resources/:resource/schema", async (req, res, next) => {
    try {
      const body = mongoCreateResourceSchema
        .pick({ schema: true, validationLevel: true, validationAction: true })
        .parse(req.body);
      if (!body.schema) throw new RudraError("VALIDATION_ERROR", "schema is required");
      const ds = registry.resolveDataSource(req.params.source!);
      const resource = registry.resolveResource(ds.id, req.params.resource!);
      const updated = registry.setSchema(resource.id, body.schema as never, {
        validationLevel: body.validationLevel,
        validationAction: body.validationAction,
      });
      const db = await clients.getDb(ds.id);
      await ensureCollection(db, updated);
      res.json(data(updated));
    } catch (error) {
      next(error);
    }
  });

  router.post("/:source/resources/:resource/indexes", async (req, res, next) => {
    try {
      const body = mongoCreateIndexSchema.parse(req.body);
      const ds = registry.resolveDataSource(req.params.source!);
      const resource = registry.resolveResource(ds.id, req.params.resource!);
      for (const field of Object.keys(body.fields)) {
        assertFieldPath(field);
      }
      const index = {
        id: randomUUID(),
        name: body.name ?? `idx_${randomUUID().replace(/-/g, "").slice(0, 12)}`,
        fields: body.fields,
        unique: body.unique ?? false,
        sparse: body.sparse ?? false,
        expireAfterSeconds: body.expireAfterSeconds,
        partialFilterExpression: body.partialFilterExpression,
      };
      const db = await clients.getDb(ds.id);
      await createIndex(db, resource, index);
      res.status(201).json(data(registry.addIndex(resource.id, index)));
    } catch (error) {
      next(error);
    }
  });

  router.get("/:source/data/:resource", async (req, res, next) => {
    try {
      const ds = registry.resolveDataSource(req.params.source!);
      const resource = registry.resolveResource(ds.id, req.params.resource!);
      const pagination = parsePagination(req.query as Record<string, unknown>);
      const db = await clients.getDb(ds.id);
      const rows = await listDocuments(db, resource, {
        limit: pagination.limit,
        skip: pagination.skip,
        sort: pagination.sort
          ? [{ field: pagination.sort, direction: pagination.order }]
          : undefined,
      });
      res.json(data(rows, { page: pagination.page, limit: pagination.limit }));
    } catch (error) {
      next(error);
    }
  });

  router.get("/:source/data/:resource/:id", async (req, res, next) => {
    try {
      const ds = registry.resolveDataSource(req.params.source!);
      const resource = registry.resolveResource(ds.id, req.params.resource!);
      const db = await clients.getDb(ds.id);
      res.json(data(await getDocument(db, resource, req.params.id!)));
    } catch (error) {
      next(error);
    }
  });

  router.post("/:source/data/:resource", async (req, res, next) => {
    try {
      if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)) {
        throw new RudraError("VALIDATION_ERROR", "JSON object body required");
      }
      const ds = registry.resolveDataSource(req.params.source!);
      const resource = registry.resolveResource(ds.id, req.params.resource!);
      const db = await clients.getDb(ds.id);
      res.status(201).json(data(await createDocument(db, resource, req.body)));
    } catch (error) {
      next(error);
    }
  });

  router.patch("/:source/data/:resource/:id", async (req, res, next) => {
    try {
      const ds = registry.resolveDataSource(req.params.source!);
      const resource = registry.resolveResource(ds.id, req.params.resource!);
      const db = await clients.getDb(ds.id);
      res.json(data(await updateDocument(db, resource, req.params.id!, req.body)));
    } catch (error) {
      next(error);
    }
  });

  router.delete("/:source/data/:resource/:id", async (req, res, next) => {
    try {
      const ds = registry.resolveDataSource(req.params.source!);
      const resource = registry.resolveResource(ds.id, req.params.resource!);
      const db = await clients.getDb(ds.id);
      res.json(data(await deleteDocument(db, resource, req.params.id!)));
    } catch (error) {
      next(error);
    }
  });

  router.post("/:source/data/:resource/query", async (req, res, next) => {
    try {
      const body = mongoQuerySchema.parse(req.body);
      const ds = registry.resolveDataSource(req.params.source!);
      const resource = registry.resolveResource(ds.id, req.params.resource!);
      const db = await clients.getDb(ds.id);
      res.json(data(await queryDocuments(db, resource, body)));
    } catch (error) {
      next(error);
    }
  });

  router.post("/:source/data/:resource/aggregate", async (req, res, next) => {
    try {
      const body = mongoAggregateSchema.parse(req.body);
      const ds = registry.resolveDataSource(req.params.source!);
      const resource = registry.resolveResource(ds.id, req.params.resource!);
      const db = await clients.getDb(ds.id);
      res.json(data(await aggregateDocuments(db, resource, body.stages)));
    } catch (error) {
      next(error);
    }
  });

  router.post("/:source/data/:resource/bulk", async (req, res, next) => {
    try {
      const body = mongoBulkCreateSchema.parse(req.body);
      const ds = registry.resolveDataSource(req.params.source!);
      const resource = registry.resolveResource(ds.id, req.params.resource!);
      const db = await clients.getDb(ds.id);
      res.status(201).json(data(await bulkCreate(db, resource, body.records)));
    } catch (error) {
      next(error);
    }
  });

  router.patch("/:source/data/:resource/bulk", async (req, res, next) => {
    try {
      const body = mongoBulkUpdateSchema.parse(req.body);
      const ds = registry.resolveDataSource(req.params.source!);
      const resource = registry.resolveResource(ds.id, req.params.resource!);
      const db = await clients.getDb(ds.id);
      res.json(data(await bulkUpdate(db, resource, body.records)));
    } catch (error) {
      next(error);
    }
  });

  router.delete("/:source/data/:resource/bulk", async (req, res, next) => {
    try {
      const body = mongoBulkDeleteSchema.parse(req.body);
      const ds = registry.resolveDataSource(req.params.source!);
      const resource = registry.resolveResource(ds.id, req.params.resource!);
      const db = await clients.getDb(ds.id);
      res.json(data(await bulkDelete(db, resource, body.ids)));
    } catch (error) {
      next(error);
    }
  });

  router.use((
    error: unknown,
    _req: import("express").Request,
    _res: import("express").Response,
    next: import("express").NextFunction,
  ) => {
    if (error instanceof ZodError) {
      next(
        new RudraError("VALIDATION_ERROR", "Invalid request", {
          details: error.flatten(),
        }),
      );
      return;
    }
    next(error);
  });

  return router;
}
