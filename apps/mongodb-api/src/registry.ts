import { randomUUID } from "node:crypto";
import { RudraError } from "@rudra/errors";
import { assertResourceSlug, physicalTableName } from "@rudra/metadata";
import type {
  MongoDataSourceRecord,
  MongoIndexRecord,
  MongoResourceRecord,
  MongoSchemaNode,
} from "./types.js";

function now(): string {
  return new Date().toISOString();
}

export class MongoRegistry {
  private dataSources = new Map<string, MongoDataSourceRecord>();
  private dataSourcesByName = new Map<string, string>();
  private resources = new Map<string, MongoResourceRecord>();

  createDataSource(input: {
    name: string;
    connectionString: string;
    database?: string;
    applicationId?: string;
    environmentId?: string;
    connectionSecretId?: string;
  }): MongoDataSourceRecord {
    if (this.dataSourcesByName.has(input.name)) {
      throw new RudraError("CONFLICT", `Data source already exists: ${input.name}`);
    }
    const ts = now();
    const record: MongoDataSourceRecord = {
      id: randomUUID(),
      name: input.name,
      connectionString: input.connectionString,
      database: input.database ?? "rudra",
      applicationId: input.applicationId,
      environmentId: input.environmentId,
      connectionSecretId: input.connectionSecretId,
      createdAt: ts,
      updatedAt: ts,
    };
    this.dataSources.set(record.id, record);
    this.dataSourcesByName.set(record.name, record.id);
    return record;
  }

  listDataSources(): MongoDataSourceRecord[] {
    return [...this.dataSources.values()];
  }

  resolveDataSource(source: string): MongoDataSourceRecord {
    const byId = this.dataSources.get(source);
    if (byId) return byId;
    const id = this.dataSourcesByName.get(source);
    if (id) {
      const ds = this.dataSources.get(id);
      if (ds) return ds;
    }
    throw new RudraError("DATASOURCE_NOT_FOUND", `Data source not found: ${source}`);
  }

  createResource(input: {
    dataSourceId: string;
    name: string;
    schema?: Record<string, MongoSchemaNode>;
    validationLevel?: "off" | "strict" | "moderate";
    validationAction?: "error" | "warn";
  }): MongoResourceRecord {
    assertResourceSlug(input.name);
    const ds = this.resolveDataSource(input.dataSourceId);
    if (this.listResources(ds.id).some((resource) => resource.name === input.name)) {
      throw new RudraError("CONFLICT", `Resource already exists: ${input.name}`);
    }
    const id = randomUUID();
    const ts = now();
    const record: MongoResourceRecord = {
      id,
      dataSourceId: ds.id,
      name: input.name,
      physicalCollection: physicalTableName(id),
      schema: input.schema,
      validationLevel: input.validationLevel ?? (input.schema ? "strict" : "off"),
      validationAction: input.validationAction ?? "error",
      indexes: [],
      createdAt: ts,
      updatedAt: ts,
    };
    this.resources.set(id, record);
    return record;
  }

  listResources(dataSourceId: string): MongoResourceRecord[] {
    return [...this.resources.values()].filter((resource) => resource.dataSourceId === dataSourceId);
  }

  resolveResource(dataSourceId: string, resourceNameOrId: string): MongoResourceRecord {
    const match = this.listResources(dataSourceId).find(
      (resource) => resource.id === resourceNameOrId || resource.name === resourceNameOrId,
    );
    if (!match) throw new RudraError("RESOURCE_NOT_FOUND", `Resource not found: ${resourceNameOrId}`);
    return match;
  }

  updateResource(resource: MongoResourceRecord): MongoResourceRecord {
    const updated = { ...resource, updatedAt: now() };
    this.resources.set(updated.id, updated);
    return updated;
  }

  setSchema(
    resourceId: string,
    schema: Record<string, MongoSchemaNode>,
    options?: { validationLevel?: "off" | "strict" | "moderate"; validationAction?: "error" | "warn" },
  ): MongoResourceRecord {
    const resource = this.resources.get(resourceId);
    if (!resource) throw new RudraError("RESOURCE_NOT_FOUND", "Resource not found");
    resource.schema = schema;
    if (options?.validationLevel) resource.validationLevel = options.validationLevel;
    if (options?.validationAction) resource.validationAction = options.validationAction;
    if (resource.validationLevel === "off") resource.validationLevel = "strict";
    return this.updateResource(resource);
  }

  addIndex(resourceId: string, index: MongoIndexRecord): MongoResourceRecord {
    const resource = this.resources.get(resourceId);
    if (!resource) throw new RudraError("RESOURCE_NOT_FOUND", "Resource not found");
    if (resource.indexes.some((item) => item.name === index.name)) {
      throw new RudraError("CONFLICT", `Index already exists: ${index.name}`);
    }
    resource.indexes.push(index);
    return this.updateResource(resource);
  }
}
