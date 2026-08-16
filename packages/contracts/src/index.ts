import { z } from "zod";

export * from "./postgres.js";

export const healthResponseSchema = z.object({
  status: z.literal("ok"),
  service: z.string(),
  version: z.string().optional(),
  uptimeSeconds: z.number().optional(),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;

export const errorResponseSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    requestId: z.string(),
    details: z.unknown().optional(),
  }),
});

export type ErrorResponse = z.infer<typeof errorResponseSchema>;

export const createAppSchema = z.object({
  name: z.string().min(1).max(120),
  slug: z
    .string()
    .min(1)
    .max(80)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
    .optional(),
  metadata: z.record(z.unknown()).optional(),
});

export const updateAppSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  metadata: z.record(z.unknown()).optional(),
});

export const createEnvironmentSchema = z.object({
  name: z.enum(["development", "staging", "production"]).or(z.string().min(1).max(64)),
  slug: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
    .optional(),
});

export const createSecretSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(128)
    .regex(/^[A-Z][A-Z0-9_]*$/),
  value: z.string().min(1),
  environmentId: z.string().min(1),
  applicationId: z.string().min(1).optional(),
});

export const createDataSourceSchema = z.object({
  applicationId: z.string().min(1),
  environmentId: z.string().min(1),
  name: z.string().min(1).max(120),
  type: z.enum(["postgres", "mongodb"]),
  connectionSecretId: z.string().min(1),
  ssl: z.boolean().optional(),
  options: z.record(z.unknown()).optional(),
});

export const createResourceSchema = z.object({
  dataSourceId: z.string().min(1),
  name: z
    .string()
    .min(1)
    .max(63)
    .regex(/^[a-z][a-z0-9_]*$/),
  kind: z.enum(["table", "collection"]).optional(),
  fields: z.array(z.record(z.unknown())).optional(),
  schema: z.record(z.unknown()).optional(),
});

export const createFieldSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(63)
    .regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/),
  type: z.string().min(1),
  nullable: z.boolean().optional(),
  primaryKey: z.boolean().optional(),
  unique: z.boolean().optional(),
  default: z.unknown().optional(),
  length: z.number().int().positive().optional(),
  precision: z.number().int().positive().optional(),
  scale: z.number().int().nonnegative().optional(),
  array: z.boolean().optional(),
  options: z.record(z.unknown()).optional(),
});

export const createIndexSchema = z.object({
  name: z.string().min(1).max(63),
  type: z.enum(["btree", "hash", "gin", "gist", "brin"]).optional(),
  fields: z.array(z.string().min(1)).min(1),
  unique: z.boolean().optional(),
  options: z.record(z.unknown()).optional(),
});

export const createRelationSchema = z.object({
  field: z.string().min(1),
  references: z.object({
    resource: z.string().min(1),
    field: z.string().min(1),
  }),
  onDelete: z.enum(["cascade", "restrict", "set null", "set default", "no action"]).optional(),
  onUpdate: z.enum(["cascade", "restrict", "set null", "set default", "no action"]).optional(),
});

export const createApiKeySchema = z.object({
  applicationId: z.string().min(1),
  environmentId: z.string().min(1),
  name: z.string().min(1).max(120),
  scopes: z.array(z.string()).default([]),
  expiresAt: z.string().datetime().optional(),
});

export const identitySchema = z.object({
  subject: z.string().min(1),
  applicationId: z.string().optional(),
  environmentId: z.string().optional(),
  roles: z.array(z.string()).default([]),
  claims: z.record(z.unknown()).default({}),
});

export type Identity = z.infer<typeof identitySchema>;

export type Application = {
  id: string;
  name: string;
  slug: string;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type Environment = {
  id: string;
  applicationId: string;
  name: string;
  slug: string;
  createdAt: string;
  updatedAt: string;
};

export type SecretRecord = {
  id: string;
  applicationId: string | null;
  environmentId: string;
  name: string;
  configured: true;
  createdAt: string;
  updatedAt: string;
};

export type DataSource = {
  id: string;
  applicationId: string;
  environmentId: string;
  name: string;
  type: "postgres" | "mongodb";
  connectionSecretId: string;
  ssl: boolean;
  options: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type Resource = {
  id: string;
  dataSourceId: string;
  name: string;
  slug: string;
  physicalSchema: string | null;
  physicalName: string;
  kind: "table" | "collection";
  createdAt: string;
  updatedAt: string;
};

export type Field = {
  id: string;
  resourceId: string;
  name: string;
  type: string;
  nullable: boolean;
  primaryKey: boolean;
  unique: boolean;
  defaultValue: unknown;
  options: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type IndexDef = {
  id: string;
  resourceId: string;
  name: string;
  type: string;
  fields: string[];
  unique: boolean;
  options: Record<string, unknown>;
  createdAt: string;
};

export type Relation = {
  id: string;
  resourceId: string;
  field: string;
  referencesResource: string;
  referencesField: string;
  onDelete: string;
  onUpdate: string;
  createdAt: string;
};

export type ApiKeyRecord = {
  id: string;
  applicationId: string;
  environmentId: string;
  name: string;
  prefix: string;
  scopes: string[];
  expiresAt: string | null;
  revokedAt: string | null;
  createdAt: string;
};

export type ApiKeyCreated = ApiKeyRecord & {
  key: string;
};
