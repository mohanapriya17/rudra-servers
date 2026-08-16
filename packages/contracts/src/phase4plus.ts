import { z } from "zod";

export const graphqlResolverSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("postgres"),
    dataSourceId: z.string().min(1),
    resource: z.string().min(1),
    operation: z.enum(["findMany", "findOne", "create", "update", "delete"]),
    mapping: z.record(z.string()).optional(),
    idArg: z.string().optional(),
  }),
  z.object({
    type: z.literal("mongodb"),
    dataSourceId: z.string().min(1),
    resource: z.string().min(1),
    operation: z.enum(["findMany", "findOne", "create", "update", "delete"]),
    mapping: z.record(z.string()).optional(),
    idArg: z.string().optional(),
  }),
  z.object({
    type: z.literal("rest"),
    method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]),
    url: z.string().min(1),
    params: z.record(z.string()).optional(),
    headers: z.record(z.string()).optional(),
    body: z.unknown().optional(),
  }),
  z.object({
    type: z.literal("function"),
    functionId: z.string().min(1),
  }),
  z.object({
    type: z.literal("static"),
    value: z.unknown(),
  }),
  z.object({
    type: z.literal("parent"),
    field: z.string().min(1),
  }),
]);

export const graphqlFieldSchema = z.object({
  name: z.string().min(1).max(80),
  type: z.string().min(1),
  args: z
    .array(
      z.object({
        name: z.string().min(1),
        type: z.string().min(1),
      }),
    )
    .optional(),
  resolver: graphqlResolverSchema.optional(),
});

export const graphqlTypeSchema = z.object({
  name: z.string().min(1).max(80),
  kind: z.enum(["object", "input"]).default("object"),
  fields: z.array(graphqlFieldSchema).min(1),
});

export const graphqlCreateSchemaSchema = z.object({
  name: z.string().min(1).max(120),
  introspection: z.boolean().optional(),
  queryDepthLimit: z.number().int().positive().max(50).optional(),
  queryComplexityLimit: z.number().int().positive().max(10000).optional(),
  types: z.array(graphqlTypeSchema).optional(),
  queries: z.array(graphqlFieldSchema).optional(),
  mutations: z.array(graphqlFieldSchema).optional(),
});

export const fileUploadUrlSchema = z.object({
  fileName: z.string().min(1).max(255),
  mimeType: z.string().min(1).max(200),
  size: z.number().int().positive().max(5_000_000_000),
  visibility: z.enum(["private", "public"]).default("private"),
  applicationId: z.string().optional(),
  environmentId: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
});

export const functionCreateSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(80)
    .regex(/^[a-zA-Z][a-zA-Z0-9_-]*$/),
  description: z.string().max(500).optional(),
  runtime: z.literal("trusted-js").default("trusted-js"),
  code: z.string().min(1).max(200_000),
  timeoutMs: z.number().int().positive().max(60_000).default(10_000),
  triggers: z
    .array(z.enum(["http", "webhook", "manual", "scheduled", "database", "background"]))
    .default(["http"]),
  secrets: z.array(z.string()).default([]),
});

export const functionInvokeSchema = z.object({
  input: z.unknown().optional(),
});
