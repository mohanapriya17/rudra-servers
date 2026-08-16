import { Router } from "express";
import { randomUUID } from "node:crypto";
import { ZodError } from "zod";
import {
  postgresBulkCreateSchema,
  postgresBulkDeleteSchema,
  postgresBulkUpdateSchema,
  postgresCreateDataSourceSchema,
  postgresCreateIndexSchema,
  postgresCreateRelationSchema,
  postgresCreateResourceSchema,
  postgresFieldInputSchema,
  postgresQuerySchema,
  postgresTransactionSchema,
  postgresUpsertSchema,
} from "@rudra/contracts";
import { RudraError } from "@rudra/errors";
import type { PostgresRegistry } from "../registry.js";
import type { PoolManager } from "../pool-manager.js";
import {
  addPhysicalColumn,
  alterPhysicalColumnNullable,
  createPhysicalIndex,
  createPhysicalRelation,
  createPhysicalTable,
  dropPhysicalColumn,
  newFieldRecord,
} from "../schema/ddl.js";
import {
  bulkCreate,
  bulkDelete,
  bulkUpdate,
  createRow,
  deleteRow,
  getRow,
  listRows,
  queryRows,
  runTransaction,
  updateRow,
  upsertRow,
} from "../data/service.js";
import { toPublicDataSource } from "../types.js";

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
    offset: (page - 1) * limit,
    sort,
    order: order as "asc" | "desc",
  };
}

export function createPostgresRouter(
  registry: PostgresRegistry,
  pools: PoolManager,
): Router {
  const router = Router();

  router.post("/datasources", async (req, res, next) => {
    try {
      const body = postgresCreateDataSourceSchema.parse(req.body);
      let connectionString = body.connectionString;
      if (!connectionString && body.connectionSecretId) {
        // Phase 2: allow env-based secret resolution for registered secret IDs
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
        ssl: body.ssl,
        applicationId: body.applicationId,
        environmentId: body.environmentId,
        connectionSecretId: body.connectionSecretId,
      });
      await pools.getPool(ds.id);
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
      const body = postgresCreateResourceSchema.parse(req.body);
      const ds = registry.resolveDataSource(req.params.source!);
      const fields = body.fields.map((field) => newFieldRecord(field));
      const resource = registry.createResource({
        dataSourceId: ds.id,
        name: body.name,
        fields,
        applicationId: ds.applicationId,
      });
      const pool = await pools.getPool(ds.id);
      await createPhysicalTable(pool, resource);
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

  router.post("/:source/resources/:resource/fields", async (req, res, next) => {
    try {
      const body = postgresFieldInputSchema.parse(req.body);
      const ds = registry.resolveDataSource(req.params.source!);
      const resource = registry.resolveResource(ds.id, req.params.resource!);
      const field = newFieldRecord(body);
      const pool = await pools.getPool(ds.id);
      await addPhysicalColumn(pool, resource, field);
      const updated = registry.addField(resource.id, field);
      res.status(201).json(data(updated));
    } catch (error) {
      next(error);
    }
  });

  router.patch("/:source/resources/:resource/fields/:field", async (req, res, next) => {
    try {
      const body = postgresFieldInputSchema.partial().parse(req.body);
      const ds = registry.resolveDataSource(req.params.source!);
      const resource = registry.resolveResource(ds.id, req.params.resource!);
      const field = resource.fields.find(
        (item) => item.name === req.params.field || item.id === req.params.field,
      );
      if (!field) throw new RudraError("NOT_FOUND", "Field not found");

      // Reject unsafe type changes in Phase 2
      if (body.type && body.type !== field.type) {
        throw new RudraError(
          "UNSUPPORTED_OPERATION",
          "Changing field type is not supported; create a new field instead",
        );
      }
      if (body.name && body.name !== field.name) {
        throw new RudraError("UNSUPPORTED_OPERATION", "Renaming fields is not supported yet");
      }

      const pool = await pools.getPool(ds.id);
      if (body.nullable != null && body.nullable !== field.nullable) {
        if (body.nullable === false) {
          const confirm = req.query.confirm === "true" || req.body?.confirm === true;
          if (!confirm) {
            throw new RudraError(
              "VALIDATION_ERROR",
              "Setting NOT NULL on an existing column requires confirm=true",
            );
          }
        }
        await alterPhysicalColumnNullable(pool, resource, field.name, body.nullable);
      }

      const updated = registry.updateField(resource.id, field.name, {
        nullable: body.nullable ?? field.nullable,
        unique: body.unique ?? field.unique,
        defaultValue: body.default !== undefined ? body.default : field.defaultValue,
      });
      res.json(data(updated));
    } catch (error) {
      next(error);
    }
  });

  router.delete("/:source/resources/:resource/fields/:field", async (req, res, next) => {
    try {
      const confirm = req.query.confirm === "true";
      if (!confirm) {
        throw new RudraError(
          "VALIDATION_ERROR",
          "Deleting a field requires confirm=true",
        );
      }
      const ds = registry.resolveDataSource(req.params.source!);
      const resource = registry.resolveResource(ds.id, req.params.resource!);
      const field = resource.fields.find(
        (item) => item.name === req.params.field || item.id === req.params.field,
      );
      if (!field) throw new RudraError("NOT_FOUND", "Field not found");
      const pool = await pools.getPool(ds.id);
      await dropPhysicalColumn(pool, resource, field.name);
      const updated = registry.removeField(resource.id, field.name);
      res.json(data(updated));
    } catch (error) {
      next(error);
    }
  });

  router.post("/:source/resources/:resource/indexes", async (req, res, next) => {
    try {
      const body = postgresCreateIndexSchema.parse(req.body);
      const ds = registry.resolveDataSource(req.params.source!);
      const resource = registry.resolveResource(ds.id, req.params.resource!);
      for (const fieldName of body.fields) {
        if (!resource.fields.some((field) => field.name === fieldName)) {
          throw new RudraError("VALIDATION_ERROR", `Unknown index field: ${fieldName}`);
        }
      }
      const index = {
        id: randomUUID(),
        name: body.name,
        type: body.type,
        fields: body.fields,
        unique: body.unique ?? false,
      };
      const pool = await pools.getPool(ds.id);
      await createPhysicalIndex(pool, resource, index);
      res.status(201).json(data(registry.addIndex(resource.id, index)));
    } catch (error) {
      next(error);
    }
  });

  router.post("/:source/resources/:resource/relations", async (req, res, next) => {
    try {
      const body = postgresCreateRelationSchema.parse(req.body);
      const ds = registry.resolveDataSource(req.params.source!);
      const resource = registry.resolveResource(ds.id, req.params.resource!);
      const referenced = registry.resolveResource(ds.id, body.references.resource);
      if (!resource.fields.some((field) => field.name === body.field)) {
        throw new RudraError("VALIDATION_ERROR", `Unknown relation field: ${body.field}`);
      }
      if (!referenced.fields.some((field) => field.name === body.references.field)) {
        throw new RudraError(
          "VALIDATION_ERROR",
          `Unknown referenced field: ${body.references.field}`,
        );
      }
      const relation = {
        id: randomUUID(),
        field: body.field,
        referencesResource: referenced.name,
        referencesField: body.references.field,
        onDelete: body.onDelete ?? "no action",
        onUpdate: body.onUpdate ?? "no action",
      };
      const pool = await pools.getPool(ds.id);
      await createPhysicalRelation(pool, resource, referenced, relation);
      res.status(201).json(data(registry.addRelation(resource.id, relation)));
    } catch (error) {
      next(error);
    }
  });

  router.get("/:source/data/:resource", async (req, res, next) => {
    try {
      const ds = registry.resolveDataSource(req.params.source!);
      const resource = registry.resolveResource(ds.id, req.params.resource!);
      const pagination = parsePagination(req.query as Record<string, unknown>);
      const pool = await pools.getPool(ds.id);
      const rows = await listRows(pool, resource, {
        limit: pagination.limit,
        offset: pagination.offset,
        orderBy: pagination.sort
          ? [{ field: pagination.sort, direction: pagination.order }]
          : undefined,
      });
      res.json(
        data(rows, {
          page: pagination.page,
          limit: pagination.limit,
        }),
      );
    } catch (error) {
      next(error);
    }
  });

  router.get("/:source/data/:resource/:id", async (req, res, next) => {
    try {
      const ds = registry.resolveDataSource(req.params.source!);
      const resource = registry.resolveResource(ds.id, req.params.resource!);
      const pool = await pools.getPool(ds.id);
      res.json(data(await getRow(pool, resource, req.params.id!)));
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
      const pool = await pools.getPool(ds.id);
      res.status(201).json(data(await createRow(pool, resource, req.body)));
    } catch (error) {
      next(error);
    }
  });

  router.patch("/:source/data/:resource/:id", async (req, res, next) => {
    try {
      const ds = registry.resolveDataSource(req.params.source!);
      const resource = registry.resolveResource(ds.id, req.params.resource!);
      const pool = await pools.getPool(ds.id);
      res.json(data(await updateRow(pool, resource, req.params.id!, req.body)));
    } catch (error) {
      next(error);
    }
  });

  router.delete("/:source/data/:resource/:id", async (req, res, next) => {
    try {
      const ds = registry.resolveDataSource(req.params.source!);
      const resource = registry.resolveResource(ds.id, req.params.resource!);
      const pool = await pools.getPool(ds.id);
      res.json(data(await deleteRow(pool, resource, req.params.id!)));
    } catch (error) {
      next(error);
    }
  });

  router.post("/:source/data/:resource/query", async (req, res, next) => {
    try {
      const body = postgresQuerySchema.parse(req.body);
      const ds = registry.resolveDataSource(req.params.source!);
      const resource = registry.resolveResource(ds.id, req.params.resource!);
      const pool = await pools.getPool(ds.id);
      const result = await queryRows(pool, resource, body);
      res.json(result);
    } catch (error) {
      next(error);
    }
  });

  router.post("/:source/data/:resource/bulk", async (req, res, next) => {
    try {
      const body = postgresBulkCreateSchema.parse(req.body);
      const ds = registry.resolveDataSource(req.params.source!);
      const resource = registry.resolveResource(ds.id, req.params.resource!);
      const pool = await pools.getPool(ds.id);
      res.status(201).json(data(await bulkCreate(pool, resource, body.records)));
    } catch (error) {
      next(error);
    }
  });

  router.patch("/:source/data/:resource/bulk", async (req, res, next) => {
    try {
      const body = postgresBulkUpdateSchema.parse(req.body);
      const ds = registry.resolveDataSource(req.params.source!);
      const resource = registry.resolveResource(ds.id, req.params.resource!);
      const pool = await pools.getPool(ds.id);
      res.json(data(await bulkUpdate(pool, resource, body.records)));
    } catch (error) {
      next(error);
    }
  });

  router.delete("/:source/data/:resource/bulk", async (req, res, next) => {
    try {
      const body = postgresBulkDeleteSchema.parse(req.body);
      const ds = registry.resolveDataSource(req.params.source!);
      const resource = registry.resolveResource(ds.id, req.params.resource!);
      const pool = await pools.getPool(ds.id);
      res.json(data(await bulkDelete(pool, resource, body.ids)));
    } catch (error) {
      next(error);
    }
  });

  router.post("/:source/data/:resource/upsert", async (req, res, next) => {
    try {
      const body = postgresUpsertSchema.parse(req.body);
      const ds = registry.resolveDataSource(req.params.source!);
      const resource = registry.resolveResource(ds.id, req.params.resource!);
      const pool = await pools.getPool(ds.id);
      res.json(
        data(
          await upsertRow(pool, resource, body.data, body.conflictFields, body.updateFields),
        ),
      );
    } catch (error) {
      next(error);
    }
  });

  router.post("/:source/transaction", async (req, res, next) => {
    try {
      const body = postgresTransactionSchema.parse(req.body);
      const ds = registry.resolveDataSource(req.params.source!);
      const pool = await pools.getPool(ds.id);
      const results = await runTransaction(pool, (name) => registry.resolveResource(ds.id, name), body.operations);
      res.json(data(results));
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
