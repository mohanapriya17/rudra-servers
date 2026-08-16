import { z } from "zod";

export const postgresCreateDataSourceSchema = z
  .object({
    name: z
      .string()
      .min(1)
      .max(120)
      .regex(/^[a-zA-Z][a-zA-Z0-9_-]*$/),
    connectionString: z.string().min(1).optional(),
    connectionSecretId: z.string().min(1).optional(),
    ssl: z.boolean().optional(),
    applicationId: z.string().optional(),
    environmentId: z.string().optional(),
  })
  .refine((value) => Boolean(value.connectionString || value.connectionSecretId), {
    message: "connectionString or connectionSecretId is required",
  });

export const postgresFieldInputSchema = z.object({
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
  check: z.string().max(500).optional(),
});

export const postgresCreateResourceSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(63)
    .regex(/^[a-z][a-z0-9_]*$/),
  fields: z.array(postgresFieldInputSchema).min(1),
});

export const filterOperatorSchema = z.enum([
  "eq",
  "neq",
  "gt",
  "gte",
  "lt",
  "lte",
  "in",
  "notIn",
  "contains",
  "startsWith",
  "endsWith",
  "isNull",
  "notNull",
]);

export const whereClauseSchema: z.ZodType<unknown> = z.lazy(() =>
  z.union([
    z.record(z.union([filterOperatorSchema, z.record(z.unknown()), z.unknown()])),
    z.object({
      and: z.array(whereClauseSchema).optional(),
      or: z.array(whereClauseSchema).optional(),
    }),
  ]),
);

export const postgresQuerySchema = z.object({
  where: z.record(z.unknown()).optional(),
  and: z.array(z.record(z.unknown())).optional(),
  or: z.array(z.record(z.unknown())).optional(),
  orderBy: z
    .array(
      z.object({
        field: z.string().min(1),
        direction: z.enum(["asc", "desc"]).default("asc"),
      }),
    )
    .optional(),
  select: z.array(z.string().min(1)).optional(),
  limit: z.number().int().positive().max(1000).optional(),
  offset: z.number().int().nonnegative().optional(),
  aggregate: z
    .object({
      count: z.boolean().optional(),
      sum: z.array(z.string()).optional(),
      avg: z.array(z.string()).optional(),
      min: z.array(z.string()).optional(),
      max: z.array(z.string()).optional(),
      groupBy: z.array(z.string()).optional(),
    })
    .optional(),
});

export const postgresBulkCreateSchema = z.object({
  records: z.array(z.record(z.unknown())).min(1).max(500),
});

export const postgresBulkUpdateSchema = z.object({
  records: z
    .array(
      z.object({
        id: z.union([z.string(), z.number()]),
        data: z.record(z.unknown()),
      }),
    )
    .min(1)
    .max(500),
});

export const postgresBulkDeleteSchema = z.object({
  ids: z.array(z.union([z.string(), z.number()])).min(1).max(500),
});

export const postgresUpsertSchema = z.object({
  conflictFields: z.array(z.string().min(1)).min(1),
  data: z.record(z.unknown()),
  updateFields: z.array(z.string().min(1)).optional(),
});

export const postgresTransactionSchema = z.object({
  operations: z
    .array(
      z.discriminatedUnion("operation", [
        z.object({
          operation: z.literal("create"),
          resource: z.string().min(1),
          data: z.record(z.unknown()),
        }),
        z.object({
          operation: z.literal("update"),
          resource: z.string().min(1),
          id: z.union([z.string(), z.number()]),
          data: z.record(z.unknown()),
        }),
        z.object({
          operation: z.literal("delete"),
          resource: z.string().min(1),
          id: z.union([z.string(), z.number()]),
        }),
        z.object({
          operation: z.literal("upsert"),
          resource: z.string().min(1),
          conflictFields: z.array(z.string()).min(1),
          data: z.record(z.unknown()),
        }),
      ]),
    )
    .min(1)
    .max(100),
});

export const postgresCreateIndexSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(63)
    .regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/),
  type: z.enum(["btree", "hash", "gin", "gist", "brin"]).default("btree"),
  fields: z.array(z.string().min(1)).min(1),
  unique: z.boolean().optional(),
});

export const postgresCreateRelationSchema = z.object({
  field: z.string().min(1),
  references: z.object({
    resource: z.string().min(1),
    field: z.string().min(1),
  }),
  onDelete: z.enum(["cascade", "restrict", "set null", "set default", "no action"]).optional(),
  onUpdate: z.enum(["cascade", "restrict", "set null", "set default", "no action"]).optional(),
});
