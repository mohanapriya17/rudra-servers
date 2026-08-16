import { z } from "zod";

export const mongoCreateDataSourceSchema = z
  .object({
    name: z
      .string()
      .min(1)
      .max(120)
      .regex(/^[a-zA-Z][a-zA-Z0-9_-]*$/),
    connectionString: z.string().min(1).optional(),
    connectionSecretId: z.string().min(1).optional(),
    database: z.string().min(1).max(120).optional(),
    applicationId: z.string().optional(),
    environmentId: z.string().optional(),
  })
  .refine((value) => Boolean(value.connectionString || value.connectionSecretId), {
    message: "connectionString or connectionSecretId is required",
  });

export const mongoFieldTypeSchema = z.enum([
  "string",
  "boolean",
  "int",
  "long",
  "double",
  "decimal",
  "date",
  "timestamp",
  "objectId",
  "array",
  "object",
  "binary",
  "null",
]);

export const mongoSchemaNodeSchema: z.ZodType<unknown> = z.lazy(() =>
  z.object({
    type: mongoFieldTypeSchema,
    required: z.boolean().optional(),
    items: mongoSchemaNodeSchema.optional(),
    properties: z.record(mongoSchemaNodeSchema).optional(),
  }),
);

export const mongoCreateResourceSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(63)
    .regex(/^[a-z][a-z0-9_]*$/),
  schema: z.record(mongoSchemaNodeSchema).optional(),
  validationLevel: z.enum(["off", "strict", "moderate"]).optional(),
  validationAction: z.enum(["error", "warn"]).optional(),
});

export const mongoCreateIndexSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(127)
    .regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/)
    .optional(),
  fields: z.record(z.union([z.literal(1), z.literal(-1), z.literal("text"), z.literal("2d"), z.literal("2dsphere")])),
  unique: z.boolean().optional(),
  sparse: z.boolean().optional(),
  expireAfterSeconds: z.number().int().nonnegative().optional(),
  partialFilterExpression: z.record(z.unknown()).optional(),
});

export const mongoQuerySchema = z.object({
  where: z.record(z.unknown()).optional(),
  and: z.array(z.record(z.unknown())).optional(),
  or: z.array(z.record(z.unknown())).optional(),
  sort: z
    .array(
      z.object({
        field: z.string().min(1),
        direction: z.enum(["asc", "desc"]).default("asc"),
      }),
    )
    .optional(),
  projection: z.array(z.string().min(1)).optional(),
  limit: z.number().int().positive().max(1000).optional(),
  skip: z.number().int().nonnegative().optional(),
});

export const mongoAggregateSchema = z.object({
  stages: z
    .array(
      z.object({
        stage: z.enum([
          "match",
          "group",
          "sort",
          "limit",
          "skip",
          "project",
          "unwind",
          "lookup",
          "count",
        ]),
        spec: z.unknown().optional().default(null),
      }),
    )
    .min(1)
    .max(20),
});

export const mongoBulkCreateSchema = z.object({
  records: z.array(z.record(z.unknown())).min(1).max(500),
});

export const mongoBulkUpdateSchema = z.object({
  records: z
    .array(
      z.object({
        id: z.string().min(1),
        data: z.record(z.unknown()),
      }),
    )
    .min(1)
    .max(500),
});

export const mongoBulkDeleteSchema = z.object({
  ids: z.array(z.string().min(1)).min(1).max(500),
});
