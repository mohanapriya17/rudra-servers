import { randomUUID } from "node:crypto";
import { RudraError } from "@rudra/errors";
import { assertResourceSlug, physicalSchemaForApp, physicalTableName } from "@rudra/metadata";
import type {
  PostgresDataSourceRecord,
  PostgresFieldRecord,
  PostgresIndexRecord,
  PostgresRelationRecord,
  PostgresResourceRecord,
} from "./types.js";

function now(): string {
  return new Date().toISOString();
}

export class PostgresRegistry {
  private dataSources = new Map<string, PostgresDataSourceRecord>();
  private dataSourcesByName = new Map<string, string>();
  private resources = new Map<string, PostgresResourceRecord>();

  loadSnapshot(
    dataSources: PostgresDataSourceRecord[],
    resources: PostgresResourceRecord[],
  ): void {
    this.dataSources.clear();
    this.dataSourcesByName.clear();
    this.resources.clear();
    for (const ds of dataSources) {
      this.dataSources.set(ds.id, ds);
      this.dataSourcesByName.set(ds.name, ds.id);
    }
    for (const resource of resources) {
      this.resources.set(resource.id, resource);
    }
  }

  createDataSource(input: {
    name: string;
    connectionString: string;
    ssl?: boolean;
    applicationId?: string;
    environmentId?: string;
    connectionSecretId?: string;
  }): PostgresDataSourceRecord {
    if (this.dataSourcesByName.has(input.name)) {
      throw new RudraError("CONFLICT", `Data source already exists: ${input.name}`);
    }
    const ts = now();
    const record: PostgresDataSourceRecord = {
      id: randomUUID(),
      name: input.name,
      connectionString: input.connectionString,
      ssl: input.ssl ?? false,
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

  removeDataSource(source: string): void {
    const record = (() => {
      try {
        return this.resolveDataSource(source);
      } catch {
        return undefined;
      }
    })();
    if (!record) return;
    for (const resource of this.listResources(record.id)) {
      this.resources.delete(resource.id);
    }
    this.dataSources.delete(record.id);
    this.dataSourcesByName.delete(record.name);
  }

  listDataSources(): PostgresDataSourceRecord[] {
    return [...this.dataSources.values()];
  }

  resolveDataSource(source: string): PostgresDataSourceRecord {
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
    fields: PostgresFieldRecord[];
    applicationId?: string;
  }): PostgresResourceRecord {
    assertResourceSlug(input.name);
    const ds = this.resolveDataSource(input.dataSourceId);
    const existing = this.listResources(ds.id).find((resource) => resource.name === input.name);
    if (existing) {
      throw new RudraError("CONFLICT", `Resource already exists: ${input.name}`);
    }
    if (!input.fields.some((field) => field.primaryKey)) {
      throw new RudraError("VALIDATION_ERROR", "Resource must include a primary key field");
    }
    const id = randomUUID();
    const ts = now();
    const record: PostgresResourceRecord = {
      id,
      dataSourceId: ds.id,
      name: input.name,
      physicalSchema: physicalSchemaForApp(input.applicationId ?? ds.applicationId ?? ds.id),
      physicalTable: physicalTableName(id),
      fields: input.fields,
      indexes: [],
      relations: [],
      createdAt: ts,
      updatedAt: ts,
    };
    this.resources.set(id, record);
    return record;
  }

  listResources(dataSourceId: string): PostgresResourceRecord[] {
    return [...this.resources.values()].filter((resource) => resource.dataSourceId === dataSourceId);
  }

  removeResource(resourceId: string): void {
    this.resources.delete(resourceId);
  }

  resolveResource(dataSourceId: string, resourceNameOrId: string): PostgresResourceRecord {
    const resources = this.listResources(dataSourceId);
    const match = resources.find(
      (resource) => resource.id === resourceNameOrId || resource.name === resourceNameOrId,
    );
    if (!match) {
      throw new RudraError("RESOURCE_NOT_FOUND", `Resource not found: ${resourceNameOrId}`);
    }
    return match;
  }

  updateResource(resource: PostgresResourceRecord): PostgresResourceRecord {
    const updated = { ...resource, updatedAt: now() };
    this.resources.set(updated.id, updated);
    return updated;
  }

  addField(resourceId: string, field: PostgresFieldRecord): PostgresResourceRecord {
    const resource = this.resources.get(resourceId);
    if (!resource) throw new RudraError("RESOURCE_NOT_FOUND", "Resource not found");
    if (resource.fields.some((item) => item.name === field.name)) {
      throw new RudraError("CONFLICT", `Field already exists: ${field.name}`);
    }
    resource.fields.push(field);
    return this.updateResource(resource);
  }

  updateField(
    resourceId: string,
    fieldName: string,
    patch: Partial<PostgresFieldRecord>,
  ): PostgresResourceRecord {
    const resource = this.resources.get(resourceId);
    if (!resource) throw new RudraError("RESOURCE_NOT_FOUND", "Resource not found");
    const field = resource.fields.find((item) => item.name === fieldName || item.id === fieldName);
    if (!field) throw new RudraError("NOT_FOUND", `Field not found: ${fieldName}`);
    Object.assign(field, patch, { id: field.id, name: field.name });
    return this.updateResource(resource);
  }

  removeField(resourceId: string, fieldName: string): PostgresResourceRecord {
    const resource = this.resources.get(resourceId);
    if (!resource) throw new RudraError("RESOURCE_NOT_FOUND", "Resource not found");
    const field = resource.fields.find((item) => item.name === fieldName || item.id === fieldName);
    if (!field) throw new RudraError("NOT_FOUND", `Field not found: ${fieldName}`);
    if (field.primaryKey) {
      throw new RudraError("VALIDATION_ERROR", "Cannot delete primary key field");
    }
    resource.fields = resource.fields.filter((item) => item.id !== field.id);
    return this.updateResource(resource);
  }

  addIndex(resourceId: string, index: PostgresIndexRecord): PostgresResourceRecord {
    const resource = this.resources.get(resourceId);
    if (!resource) throw new RudraError("RESOURCE_NOT_FOUND", "Resource not found");
    if (resource.indexes.some((item) => item.name === index.name)) {
      throw new RudraError("CONFLICT", `Index already exists: ${index.name}`);
    }
    resource.indexes.push(index);
    return this.updateResource(resource);
  }

  addRelation(resourceId: string, relation: PostgresRelationRecord): PostgresResourceRecord {
    const resource = this.resources.get(resourceId);
    if (!resource) throw new RudraError("RESOURCE_NOT_FOUND", "Resource not found");
    resource.relations.push(relation);
    return this.updateResource(resource);
  }
}
