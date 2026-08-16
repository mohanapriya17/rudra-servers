import { Router } from "express";
import {
  createApiKeySchema,
  createAppSchema,
  createDataSourceSchema,
  createEnvironmentSchema,
  createFieldSchema,
  createIndexSchema,
  createRelationSchema,
  createResourceSchema,
  createSecretSchema,
  updateAppSchema,
} from "@rudra/contracts";
import { RudraError } from "@rudra/errors";
import type { ControlPlaneStore } from "../store/memory.js";

function data<T>(value: T): { data: T } {
  return { data: value };
}

export function createControlPlaneRouter(store: ControlPlaneStore): Router {
  const router = Router();

  // Applications
  router.post("/apps", async (req, res, next) => {
    try {
      const body = createAppSchema.parse(req.body);
      const app = await store.createApp(body);
      res.status(201).json(data(app));
    } catch (error) {
      next(error);
    }
  });

  router.get("/apps", async (_req, res, next) => {
    try {
      res.json(data(await store.listApps()));
    } catch (error) {
      next(error);
    }
  });

  router.get("/apps/:appId", async (req, res, next) => {
    try {
      res.json(data(await store.getApp(req.params.appId!)));
    } catch (error) {
      next(error);
    }
  });

  router.patch("/apps/:appId", async (req, res, next) => {
    try {
      const body = updateAppSchema.parse(req.body);
      res.json(data(await store.updateApp(req.params.appId!, body)));
    } catch (error) {
      next(error);
    }
  });

  router.delete("/apps/:appId", async (req, res, next) => {
    try {
      await store.deleteApp(req.params.appId!);
      res.status(204).send();
    } catch (error) {
      next(error);
    }
  });

  // Environments
  router.post("/apps/:appId/environments", async (req, res, next) => {
    try {
      const body = createEnvironmentSchema.parse(req.body);
      res.status(201).json(data(await store.createEnvironment(req.params.appId!, body)));
    } catch (error) {
      next(error);
    }
  });

  router.get("/apps/:appId/environments", async (req, res, next) => {
    try {
      res.json(data(await store.listEnvironments(req.params.appId!)));
    } catch (error) {
      next(error);
    }
  });

  // Secrets — never return plaintext values
  router.post("/secrets", async (req, res, next) => {
    try {
      const body = createSecretSchema.parse(req.body);
      res.status(201).json(data(await store.createSecret(body)));
    } catch (error) {
      next(error);
    }
  });

  router.get("/secrets", async (req, res, next) => {
    try {
      const environmentId = typeof req.query.environmentId === "string" ? req.query.environmentId : undefined;
      const applicationId = typeof req.query.applicationId === "string" ? req.query.applicationId : undefined;
      res.json(data(await store.listSecrets({ environmentId, applicationId })));
    } catch (error) {
      next(error);
    }
  });

  router.get("/secrets/:secretId", async (req, res, next) => {
    try {
      res.json(data(await store.getSecretMeta(req.params.secretId!)));
    } catch (error) {
      next(error);
    }
  });

  // Data sources
  router.post("/datasources", async (req, res, next) => {
    try {
      const body = createDataSourceSchema.parse(req.body);
      res.status(201).json(data(await store.createDataSource(body)));
    } catch (error) {
      next(error);
    }
  });

  router.get("/datasources", async (req, res, next) => {
    try {
      const applicationId = typeof req.query.applicationId === "string" ? req.query.applicationId : undefined;
      const environmentId = typeof req.query.environmentId === "string" ? req.query.environmentId : undefined;
      res.json(data(await store.listDataSources({ applicationId, environmentId })));
    } catch (error) {
      next(error);
    }
  });

  router.get("/datasources/:dataSourceId", async (req, res, next) => {
    try {
      res.json(data(await store.getDataSource(req.params.dataSourceId!)));
    } catch (error) {
      next(error);
    }
  });

  // Resources + nested metadata
  router.post("/resources", async (req, res, next) => {
    try {
      const body = createResourceSchema.parse(req.body);
      res.status(201).json(data(await store.createResource(body)));
    } catch (error) {
      next(error);
    }
  });

  router.get("/datasources/:dataSourceId/resources", async (req, res, next) => {
    try {
      res.json(data(await store.listResources(req.params.dataSourceId!)));
    } catch (error) {
      next(error);
    }
  });

  router.get("/resources/:resourceId", async (req, res, next) => {
    try {
      res.json(data(await store.getResource(req.params.resourceId!)));
    } catch (error) {
      next(error);
    }
  });

  router.post("/resources/:resourceId/fields", async (req, res, next) => {
    try {
      const body = createFieldSchema.parse(req.body);
      const field = await store.createField(req.params.resourceId!, {
        name: body.name,
        type: body.type,
        nullable: body.nullable ?? true,
        primaryKey: body.primaryKey ?? false,
        unique: body.unique ?? false,
        defaultValue: body.default ?? null,
        options: {
          ...(body.length != null ? { length: body.length } : {}),
          ...(body.precision != null ? { precision: body.precision } : {}),
          ...(body.scale != null ? { scale: body.scale } : {}),
          ...(body.array != null ? { array: body.array } : {}),
          ...(body.options ?? {}),
        },
      });
      res.status(201).json(data(field));
    } catch (error) {
      next(error);
    }
  });

  router.get("/resources/:resourceId/fields", async (req, res, next) => {
    try {
      res.json(data(await store.listFields(req.params.resourceId!)));
    } catch (error) {
      next(error);
    }
  });

  router.patch("/resources/:resourceId/fields/:fieldId", async (req, res, next) => {
    try {
      const body = createFieldSchema.partial().parse(req.body);
      const updated = await store.updateField(req.params.fieldId!, {
        ...(body.name != null ? { name: body.name } : {}),
        ...(body.type != null ? { type: body.type } : {}),
        ...(body.nullable != null ? { nullable: body.nullable } : {}),
        ...(body.primaryKey != null ? { primaryKey: body.primaryKey } : {}),
        ...(body.unique != null ? { unique: body.unique } : {}),
        ...(body.default !== undefined ? { defaultValue: body.default } : {}),
      });
      res.json(data(updated));
    } catch (error) {
      next(error);
    }
  });

  router.delete("/resources/:resourceId/fields/:fieldId", async (req, res, next) => {
    try {
      const confirm = req.query.confirm === "true" || req.body?.confirm === true;
      if (!confirm) {
        throw new RudraError(
          "VALIDATION_ERROR",
          "Deleting a field requires confirm=true",
        );
      }
      await store.deleteField(req.params.fieldId!);
      res.status(204).send();
    } catch (error) {
      next(error);
    }
  });

  router.post("/resources/:resourceId/indexes", async (req, res, next) => {
    try {
      const body = createIndexSchema.parse(req.body);
      const index = await store.createIndex(req.params.resourceId!, {
        name: body.name,
        type: body.type ?? "btree",
        fields: body.fields,
        unique: body.unique ?? false,
        options: body.options ?? {},
      });
      res.status(201).json(data(index));
    } catch (error) {
      next(error);
    }
  });

  router.get("/resources/:resourceId/indexes", async (req, res, next) => {
    try {
      res.json(data(await store.listIndexes(req.params.resourceId!)));
    } catch (error) {
      next(error);
    }
  });

  router.post("/resources/:resourceId/relations", async (req, res, next) => {
    try {
      const body = createRelationSchema.parse(req.body);
      const relation = await store.createRelation(req.params.resourceId!, {
        field: body.field,
        referencesResource: body.references.resource,
        referencesField: body.references.field,
        onDelete: body.onDelete ?? "no action",
        onUpdate: body.onUpdate ?? "no action",
      });
      res.status(201).json(data(relation));
    } catch (error) {
      next(error);
    }
  });

  router.get("/resources/:resourceId/relations", async (req, res, next) => {
    try {
      res.json(data(await store.listRelations(req.params.resourceId!)));
    } catch (error) {
      next(error);
    }
  });

  // API keys
  router.post("/api-keys", async (req, res, next) => {
    try {
      const body = createApiKeySchema.parse(req.body);
      const created = await store.createApiKey(body);
      res.status(201).json(data(created));
    } catch (error) {
      next(error);
    }
  });

  router.get("/api-keys", async (req, res, next) => {
    try {
      const applicationId = typeof req.query.applicationId === "string" ? req.query.applicationId : undefined;
      const environmentId = typeof req.query.environmentId === "string" ? req.query.environmentId : undefined;
      res.json(data(await store.listApiKeys({ applicationId, environmentId })));
    } catch (error) {
      next(error);
    }
  });

  router.post("/api-keys/:apiKeyId/revoke", async (req, res, next) => {
    try {
      res.json(data(await store.revokeApiKey(req.params.apiKeyId!)));
    } catch (error) {
      next(error);
    }
  });

  return router;
}
