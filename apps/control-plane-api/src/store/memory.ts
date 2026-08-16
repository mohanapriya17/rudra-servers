import { randomUUID } from "node:crypto";
import type {
  ApiKeyCreated,
  ApiKeyRecord,
  Application,
  DataSource,
  Environment,
  Field,
  IndexDef,
  Relation,
  Resource,
  SecretRecord,
} from "@rudra/contracts";
import { generateApiKey, hashApiKey } from "@rudra/auth";
import { RudraError } from "@rudra/errors";
import { physicalSchemaForApp, physicalTableName, slugifyName } from "@rudra/metadata";
import { encryptSecret, decryptSecret } from "../crypto/secrets.js";

function now(): string {
  return new Date().toISOString();
}

export interface ControlPlaneStore {
  createApp(input: { name: string; slug?: string; metadata?: Record<string, unknown> }): Promise<Application>;
  listApps(): Promise<Application[]>;
  getApp(appId: string): Promise<Application>;
  updateApp(appId: string, input: { name?: string; metadata?: Record<string, unknown> }): Promise<Application>;
  deleteApp(appId: string): Promise<void>;

  createEnvironment(appId: string, input: { name: string; slug?: string }): Promise<Environment>;
  listEnvironments(appId: string): Promise<Environment[]>;
  getEnvironment(environmentId: string): Promise<Environment>;

  createSecret(input: {
    name: string;
    value: string;
    environmentId: string;
    applicationId?: string;
  }): Promise<SecretRecord>;
  listSecrets(filter?: { environmentId?: string; applicationId?: string }): Promise<SecretRecord[]>;
  getSecretMeta(secretId: string): Promise<SecretRecord>;
  /** Internal only — never expose via HTTP. */
  resolveSecretValue(secretId: string): Promise<string>;

  createDataSource(input: {
    applicationId: string;
    environmentId: string;
    name: string;
    type: "postgres" | "mongodb";
    connectionSecretId: string;
    ssl?: boolean;
    options?: Record<string, unknown>;
  }): Promise<DataSource>;
  listDataSources(filter?: { applicationId?: string; environmentId?: string }): Promise<DataSource[]>;
  getDataSource(id: string): Promise<DataSource>;

  createResource(input: {
    dataSourceId: string;
    name: string;
    kind?: "table" | "collection";
  }): Promise<Resource>;
  listResources(dataSourceId: string): Promise<Resource[]>;
  getResource(id: string): Promise<Resource>;
  getResourceByName(dataSourceId: string, name: string): Promise<Resource>;

  createField(resourceId: string, input: Omit<Field, "id" | "resourceId" | "createdAt" | "updatedAt">): Promise<Field>;
  listFields(resourceId: string): Promise<Field[]>;
  updateField(fieldId: string, patch: Partial<Field>): Promise<Field>;
  deleteField(fieldId: string): Promise<void>;

  createIndex(resourceId: string, input: Omit<IndexDef, "id" | "resourceId" | "createdAt">): Promise<IndexDef>;
  listIndexes(resourceId: string): Promise<IndexDef[]>;

  createRelation(resourceId: string, input: Omit<Relation, "id" | "resourceId" | "createdAt">): Promise<Relation>;
  listRelations(resourceId: string): Promise<Relation[]>;

  createApiKey(input: {
    applicationId: string;
    environmentId: string;
    name: string;
    scopes: string[];
    expiresAt?: string;
  }): Promise<ApiKeyCreated>;
  listApiKeys(filter?: { applicationId?: string; environmentId?: string }): Promise<ApiKeyRecord[]>;
  revokeApiKey(id: string): Promise<ApiKeyRecord>;
  verifyApiKey(rawKey: string): Promise<ApiKeyRecord | null>;
}

export class MemoryControlPlaneStore implements ControlPlaneStore {
  private apps = new Map<string, Application>();
  private environments = new Map<string, Environment>();
  private secrets = new Map<
    string,
    SecretRecord & { ciphertext: string; iv: string; tag: string }
  >();
  private dataSources = new Map<string, DataSource>();
  private resources = new Map<string, Resource>();
  private fields = new Map<string, Field>();
  private indexes = new Map<string, IndexDef>();
  private relations = new Map<string, Relation>();
  private apiKeys = new Map<string, ApiKeyRecord & { keyHash: string }>();

  constructor(private readonly encryptionKey: string) {}

  async createApp(input: { name: string; slug?: string; metadata?: Record<string, unknown> }): Promise<Application> {
    const slug = input.slug ?? slugifyName(input.name);
    if ([...this.apps.values()].some((app) => app.slug === slug)) {
      throw new RudraError("CONFLICT", `Application slug already exists: ${slug}`);
    }
    const ts = now();
    const app: Application = {
      id: randomUUID(),
      name: input.name,
      slug,
      metadata: input.metadata ?? {},
      createdAt: ts,
      updatedAt: ts,
    };
    this.apps.set(app.id, app);
    return app;
  }

  async listApps(): Promise<Application[]> {
    return [...this.apps.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async getApp(appId: string): Promise<Application> {
    const app = this.apps.get(appId);
    if (!app) throw new RudraError("APPLICATION_NOT_FOUND", "Application not found");
    return app;
  }

  async updateApp(
    appId: string,
    input: { name?: string; metadata?: Record<string, unknown> },
  ): Promise<Application> {
    const app = await this.getApp(appId);
    const updated: Application = {
      ...app,
      name: input.name ?? app.name,
      metadata: input.metadata ?? app.metadata,
      updatedAt: now(),
    };
    this.apps.set(appId, updated);
    return updated;
  }

  async deleteApp(appId: string): Promise<void> {
    await this.getApp(appId);
    this.apps.delete(appId);
    for (const [id, env] of this.environments) {
      if (env.applicationId === appId) this.environments.delete(id);
    }
  }

  async createEnvironment(appId: string, input: { name: string; slug?: string }): Promise<Environment> {
    await this.getApp(appId);
    const slug = input.slug ?? slugifyName(input.name);
    const existing = [...this.environments.values()].find(
      (env) => env.applicationId === appId && env.slug === slug,
    );
    if (existing) throw new RudraError("CONFLICT", `Environment already exists: ${slug}`);
    const ts = now();
    const environment: Environment = {
      id: randomUUID(),
      applicationId: appId,
      name: input.name,
      slug,
      createdAt: ts,
      updatedAt: ts,
    };
    this.environments.set(environment.id, environment);
    return environment;
  }

  async listEnvironments(appId: string): Promise<Environment[]> {
    await this.getApp(appId);
    return [...this.environments.values()]
      .filter((env) => env.applicationId === appId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async getEnvironment(environmentId: string): Promise<Environment> {
    const environment = this.environments.get(environmentId);
    if (!environment) throw new RudraError("ENVIRONMENT_NOT_FOUND", "Environment not found");
    return environment;
  }

  async createSecret(input: {
    name: string;
    value: string;
    environmentId: string;
    applicationId?: string;
  }): Promise<SecretRecord> {
    const environment = await this.getEnvironment(input.environmentId);
    const applicationId = input.applicationId ?? environment.applicationId;
    await this.getApp(applicationId);
    const encrypted = encryptSecret(input.value, this.encryptionKey);
    const ts = now();
    const record: SecretRecord & { ciphertext: string; iv: string; tag: string } = {
      id: randomUUID(),
      applicationId,
      environmentId: input.environmentId,
      name: input.name,
      configured: true,
      createdAt: ts,
      updatedAt: ts,
      ...encrypted,
    };
    this.secrets.set(record.id, record);
    return {
      id: record.id,
      applicationId: record.applicationId,
      environmentId: record.environmentId,
      name: record.name,
      configured: true,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }

  async listSecrets(filter?: { environmentId?: string; applicationId?: string }): Promise<SecretRecord[]> {
    return [...this.secrets.values()]
      .filter((secret) => {
        if (filter?.environmentId && secret.environmentId !== filter.environmentId) return false;
        if (filter?.applicationId && secret.applicationId !== filter.applicationId) return false;
        return true;
      })
      .map(({ ciphertext: _c, iv: _i, tag: _t, ...meta }) => meta);
  }

  async getSecretMeta(secretId: string): Promise<SecretRecord> {
    const secret = this.secrets.get(secretId);
    if (!secret) throw new RudraError("SECRET_NOT_FOUND", "Secret not found");
    const { ciphertext: _c, iv: _i, tag: _t, ...meta } = secret;
    return meta;
  }

  async resolveSecretValue(secretId: string): Promise<string> {
    const secret = this.secrets.get(secretId);
    if (!secret) throw new RudraError("SECRET_NOT_FOUND", "Secret not found");
    return decryptSecret(
      { ciphertext: secret.ciphertext, iv: secret.iv, tag: secret.tag },
      this.encryptionKey,
    );
  }

  async createDataSource(input: {
    applicationId: string;
    environmentId: string;
    name: string;
    type: "postgres" | "mongodb";
    connectionSecretId: string;
    ssl?: boolean;
    options?: Record<string, unknown>;
  }): Promise<DataSource> {
    await this.getApp(input.applicationId);
    await this.getEnvironment(input.environmentId);
    await this.getSecretMeta(input.connectionSecretId);
    const ts = now();
    const dataSource: DataSource = {
      id: randomUUID(),
      applicationId: input.applicationId,
      environmentId: input.environmentId,
      name: input.name,
      type: input.type,
      connectionSecretId: input.connectionSecretId,
      ssl: input.ssl ?? true,
      options: input.options ?? {},
      createdAt: ts,
      updatedAt: ts,
    };
    this.dataSources.set(dataSource.id, dataSource);
    return dataSource;
  }

  async listDataSources(filter?: {
    applicationId?: string;
    environmentId?: string;
  }): Promise<DataSource[]> {
    return [...this.dataSources.values()].filter((ds) => {
      if (filter?.applicationId && ds.applicationId !== filter.applicationId) return false;
      if (filter?.environmentId && ds.environmentId !== filter.environmentId) return false;
      return true;
    });
  }

  async getDataSource(id: string): Promise<DataSource> {
    const ds = this.dataSources.get(id);
    if (!ds) throw new RudraError("DATASOURCE_NOT_FOUND", "Data source not found");
    return ds;
  }

  async createResource(input: {
    dataSourceId: string;
    name: string;
    kind?: "table" | "collection";
  }): Promise<Resource> {
    const ds = await this.getDataSource(input.dataSourceId);
    const existing = [...this.resources.values()].find(
      (resource) => resource.dataSourceId === input.dataSourceId && resource.name === input.name,
    );
    if (existing) throw new RudraError("CONFLICT", `Resource already exists: ${input.name}`);
    const id = randomUUID();
    const ts = now();
    const kind = input.kind ?? (ds.type === "postgres" ? "table" : "collection");
    const resource: Resource = {
      id,
      dataSourceId: input.dataSourceId,
      name: input.name,
      slug: input.name,
      physicalSchema: ds.type === "postgres" ? physicalSchemaForApp(ds.applicationId) : null,
      physicalName: ds.type === "postgres" ? physicalTableName(id) : input.name,
      kind,
      createdAt: ts,
      updatedAt: ts,
    };
    this.resources.set(id, resource);
    return resource;
  }

  async listResources(dataSourceId: string): Promise<Resource[]> {
    await this.getDataSource(dataSourceId);
    return [...this.resources.values()].filter((resource) => resource.dataSourceId === dataSourceId);
  }

  async getResource(id: string): Promise<Resource> {
    const resource = this.resources.get(id);
    if (!resource) throw new RudraError("RESOURCE_NOT_FOUND", "Resource not found");
    return resource;
  }

  async getResourceByName(dataSourceId: string, name: string): Promise<Resource> {
    const resource = [...this.resources.values()].find(
      (item) => item.dataSourceId === dataSourceId && item.name === name,
    );
    if (!resource) throw new RudraError("RESOURCE_NOT_FOUND", "Resource not found");
    return resource;
  }

  async createField(
    resourceId: string,
    input: Omit<Field, "id" | "resourceId" | "createdAt" | "updatedAt">,
  ): Promise<Field> {
    await this.getResource(resourceId);
    const ts = now();
    const field: Field = {
      id: randomUUID(),
      resourceId,
      ...input,
      createdAt: ts,
      updatedAt: ts,
    };
    this.fields.set(field.id, field);
    return field;
  }

  async listFields(resourceId: string): Promise<Field[]> {
    await this.getResource(resourceId);
    return [...this.fields.values()].filter((field) => field.resourceId === resourceId);
  }

  async updateField(fieldId: string, patch: Partial<Field>): Promise<Field> {
    const field = this.fields.get(fieldId);
    if (!field) throw new RudraError("NOT_FOUND", "Field not found");
    const updated: Field = {
      ...field,
      ...patch,
      id: field.id,
      resourceId: field.resourceId,
      createdAt: field.createdAt,
      updatedAt: now(),
    };
    this.fields.set(fieldId, updated);
    return updated;
  }

  async deleteField(fieldId: string): Promise<void> {
    if (!this.fields.has(fieldId)) throw new RudraError("NOT_FOUND", "Field not found");
    this.fields.delete(fieldId);
  }

  async createIndex(
    resourceId: string,
    input: Omit<IndexDef, "id" | "resourceId" | "createdAt">,
  ): Promise<IndexDef> {
    await this.getResource(resourceId);
    const index: IndexDef = {
      id: randomUUID(),
      resourceId,
      ...input,
      createdAt: now(),
    };
    this.indexes.set(index.id, index);
    return index;
  }

  async listIndexes(resourceId: string): Promise<IndexDef[]> {
    await this.getResource(resourceId);
    return [...this.indexes.values()].filter((index) => index.resourceId === resourceId);
  }

  async createRelation(
    resourceId: string,
    input: Omit<Relation, "id" | "resourceId" | "createdAt">,
  ): Promise<Relation> {
    await this.getResource(resourceId);
    const relation: Relation = {
      id: randomUUID(),
      resourceId,
      ...input,
      createdAt: now(),
    };
    this.relations.set(relation.id, relation);
    return relation;
  }

  async listRelations(resourceId: string): Promise<Relation[]> {
    await this.getResource(resourceId);
    return [...this.relations.values()].filter((relation) => relation.resourceId === resourceId);
  }

  async createApiKey(input: {
    applicationId: string;
    environmentId: string;
    name: string;
    scopes: string[];
    expiresAt?: string;
  }): Promise<ApiKeyCreated> {
    await this.getApp(input.applicationId);
    await this.getEnvironment(input.environmentId);
    const generated = generateApiKey("rk");
    const record: ApiKeyRecord & { keyHash: string } = {
      id: randomUUID(),
      applicationId: input.applicationId,
      environmentId: input.environmentId,
      name: input.name,
      prefix: generated.prefix,
      scopes: input.scopes,
      expiresAt: input.expiresAt ?? null,
      revokedAt: null,
      createdAt: now(),
      keyHash: generated.hash,
    };
    this.apiKeys.set(record.id, record);
    const { keyHash: _hash, ...publicRecord } = record;
    return { ...publicRecord, key: generated.key };
  }

  async listApiKeys(filter?: {
    applicationId?: string;
    environmentId?: string;
  }): Promise<ApiKeyRecord[]> {
    return [...this.apiKeys.values()]
      .filter((key) => {
        if (filter?.applicationId && key.applicationId !== filter.applicationId) return false;
        if (filter?.environmentId && key.environmentId !== filter.environmentId) return false;
        return true;
      })
      .map(({ keyHash: _h, ...meta }) => meta);
  }

  async revokeApiKey(id: string): Promise<ApiKeyRecord> {
    const key = this.apiKeys.get(id);
    if (!key) throw new RudraError("API_KEY_NOT_FOUND", "API key not found");
    key.revokedAt = now();
    const { keyHash: _h, ...meta } = key;
    return meta;
  }

  async verifyApiKey(rawKey: string): Promise<ApiKeyRecord | null> {
    const hash = hashApiKey(rawKey);
    const key = [...this.apiKeys.values()].find((item) => item.keyHash === hash);
    if (!key || key.revokedAt) return null;
    if (key.expiresAt && Date.parse(key.expiresAt) < Date.now()) return null;
    const { keyHash: _h, ...meta } = key;
    return meta;
  }
}
