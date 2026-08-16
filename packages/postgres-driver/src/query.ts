import type { FilterOperator } from "@rudra/metadata";
import { assertFilterOperator, assertIdentifier, quoteIdent } from "@rudra/metadata";
import { RudraError } from "@rudra/errors";
import { assertSafePhysicalRef } from "./connection.js";

export interface FieldMeta {
  name: string;
  type: string;
  primaryKey?: boolean;
  nullable?: boolean;
  unique?: boolean;
}

export interface ResourceMeta {
  name: string;
  physicalSchema: string;
  physicalTable: string;
  fields: FieldMeta[];
}

export interface BuiltQuery {
  text: string;
  values: unknown[];
}

function primaryKeyField(resource: ResourceMeta): FieldMeta {
  const pk = resource.fields.find((field) => field.primaryKey);
  if (!pk) {
    throw new RudraError("VALIDATION_ERROR", `Resource ${resource.name} has no primary key`);
  }
  return pk;
}

function fieldMap(resource: ResourceMeta): Map<string, FieldMeta> {
  return new Map(resource.fields.map((field) => [field.name, field]));
}

function assertKnownField(resource: ResourceMeta, name: string): FieldMeta {
  const field = fieldMap(resource).get(name);
  if (!field) {
    throw new RudraError("VALIDATION_ERROR", `Unknown field: ${name}`);
  }
  assertIdentifier(name, "field");
  return field;
}

function validateOperatorForType(op: FilterOperator, type: string): void {
  const stringOps = new Set(["contains", "startsWith", "endsWith"]);
  if (stringOps.has(op) && !["text", "varchar", "char"].includes(type)) {
    throw new RudraError("VALIDATION_ERROR", `Operator ${op} is only valid for string fields`);
  }
}

export function qualifiedTable(resource: ResourceMeta): string {
  return assertSafePhysicalRef(resource.physicalSchema, resource.physicalTable).qualified;
}

export function buildWhere(
  resource: ResourceMeta,
  where: Record<string, unknown> | undefined,
  startIndex = 1,
): { clause: string; values: unknown[]; nextIndex: number } {
  if (!where || Object.keys(where).length === 0) {
    return { clause: "", values: [], nextIndex: startIndex };
  }

  const values: unknown[] = [];
  let idx = startIndex;
  const parts: string[] = [];

  if (Array.isArray(where.and)) {
    const nested = where.and.map((item) => {
      const built = buildWhere(resource, item as Record<string, unknown>, idx);
      values.push(...built.values);
      idx = built.nextIndex;
      return built.clause ? `(${built.clause})` : null;
    });
    const joined = nested.filter(Boolean).join(" AND ");
    if (joined) parts.push(`(${joined})`);
  }

  if (Array.isArray(where.or)) {
    const nested = where.or.map((item) => {
      const built = buildWhere(resource, item as Record<string, unknown>, idx);
      values.push(...built.values);
      idx = built.nextIndex;
      return built.clause ? `(${built.clause})` : null;
    });
    const joined = nested.filter(Boolean).join(" OR ");
    if (joined) parts.push(`(${joined})`);
  }

  for (const [key, raw] of Object.entries(where)) {
    if (key === "and" || key === "or") continue;
    const field = assertKnownField(resource, key);

    if (raw !== null && typeof raw === "object" && !Array.isArray(raw)) {
      for (const [opRaw, value] of Object.entries(raw as Record<string, unknown>)) {
        const op = assertFilterOperator(opRaw);
        validateOperatorForType(op, field.type);
        const col = quoteIdent(field.name);
        switch (op) {
          case "eq":
            parts.push(`${col} = $${idx++}`);
            values.push(value);
            break;
          case "neq":
            parts.push(`${col} <> $${idx++}`);
            values.push(value);
            break;
          case "gt":
            parts.push(`${col} > $${idx++}`);
            values.push(value);
            break;
          case "gte":
            parts.push(`${col} >= $${idx++}`);
            values.push(value);
            break;
          case "lt":
            parts.push(`${col} < $${idx++}`);
            values.push(value);
            break;
          case "lte":
            parts.push(`${col} <= $${idx++}`);
            values.push(value);
            break;
          case "in":
            if (!Array.isArray(value) || value.length === 0) {
              throw new RudraError("VALIDATION_ERROR", "in operator requires a non-empty array");
            }
            parts.push(`${col} = ANY($${idx++})`);
            values.push(value);
            break;
          case "notIn":
            if (!Array.isArray(value) || value.length === 0) {
              throw new RudraError("VALIDATION_ERROR", "notIn operator requires a non-empty array");
            }
            parts.push(`NOT (${col} = ANY($${idx++}))`);
            values.push(value);
            break;
          case "contains":
            parts.push(`${col} LIKE $${idx++}`);
            values.push(`%${String(value)}%`);
            break;
          case "startsWith":
            parts.push(`${col} LIKE $${idx++}`);
            values.push(`${String(value)}%`);
            break;
          case "endsWith":
            parts.push(`${col} LIKE $${idx++}`);
            values.push(`%${String(value)}`);
            break;
          case "isNull":
            parts.push(`${col} IS NULL`);
            break;
          case "notNull":
            parts.push(`${col} IS NOT NULL`);
            break;
          default:
            throw new RudraError("VALIDATION_ERROR", `Unsupported operator: ${op}`);
        }
      }
    } else {
      parts.push(`${quoteIdent(field.name)} = $${idx++}`);
      values.push(raw);
    }
  }

  return {
    clause: parts.join(" AND "),
    values,
    nextIndex: idx,
  };
}

export function buildSelectQuery(
  resource: ResourceMeta,
  options: {
    where?: Record<string, unknown>;
    orderBy?: Array<{ field: string; direction: "asc" | "desc" }>;
    select?: string[];
    limit?: number;
    offset?: number;
  },
): BuiltQuery {
  const table = qualifiedTable(resource);
  let columns = "*";
  if (options.select?.length) {
    columns = options.select
      .map((name) => {
        assertKnownField(resource, name);
        return quoteIdent(name);
      })
      .join(", ");
  }

  const where = buildWhere(resource, options.where);
  const values = [...where.values];
  let idx = where.nextIndex;
  let text = `SELECT ${columns} FROM ${table}`;
  if (where.clause) text += ` WHERE ${where.clause}`;

  if (options.orderBy?.length) {
    const order = options.orderBy
      .map((item) => {
        assertKnownField(resource, item.field);
        return `${quoteIdent(item.field)} ${item.direction === "desc" ? "DESC" : "ASC"}`;
      })
      .join(", ");
    text += ` ORDER BY ${order}`;
  }

  if (options.limit != null) {
    text += ` LIMIT $${idx++}`;
    values.push(options.limit);
  }
  if (options.offset != null) {
    text += ` OFFSET $${idx++}`;
    values.push(options.offset);
  }

  return { text, values };
}

export function buildInsertQuery(
  resource: ResourceMeta,
  data: Record<string, unknown>,
): BuiltQuery {
  const entries = Object.entries(data);
  if (entries.length === 0) {
    throw new RudraError("VALIDATION_ERROR", "Insert data cannot be empty");
  }
  for (const [key] of entries) assertKnownField(resource, key);

  const columns = entries.map(([key]) => quoteIdent(key)).join(", ");
  const placeholders = entries.map((_, i) => `$${i + 1}`).join(", ");
  const values = entries.map(([, value]) => value);
  const text = `INSERT INTO ${qualifiedTable(resource)} (${columns}) VALUES (${placeholders}) RETURNING *`;
  return { text, values };
}

export function buildUpdateQuery(
  resource: ResourceMeta,
  id: string | number,
  data: Record<string, unknown>,
): BuiltQuery {
  const pk = primaryKeyField(resource);
  const entries = Object.entries(data);
  if (entries.length === 0) {
    throw new RudraError("VALIDATION_ERROR", "Update data cannot be empty");
  }
  for (const [key] of entries) {
    if (key === pk.name) {
      throw new RudraError("VALIDATION_ERROR", "Cannot update primary key");
    }
    assertKnownField(resource, key);
  }

  const sets = entries.map(([key], i) => `${quoteIdent(key)} = $${i + 1}`).join(", ");
  const values = entries.map(([, value]) => value);
  values.push(id);
  const text = `UPDATE ${qualifiedTable(resource)} SET ${sets} WHERE ${quoteIdent(pk.name)} = $${values.length} RETURNING *`;
  return { text, values };
}

export function buildDeleteQuery(resource: ResourceMeta, id: string | number): BuiltQuery {
  const pk = primaryKeyField(resource);
  return {
    text: `DELETE FROM ${qualifiedTable(resource)} WHERE ${quoteIdent(pk.name)} = $1 RETURNING *`,
    values: [id],
  };
}

export function buildUpsertQuery(
  resource: ResourceMeta,
  data: Record<string, unknown>,
  conflictFields: string[],
  updateFields?: string[],
): BuiltQuery {
  for (const field of conflictFields) assertKnownField(resource, field);
  const entries = Object.entries(data);
  if (entries.length === 0) {
    throw new RudraError("VALIDATION_ERROR", "Upsert data cannot be empty");
  }
  for (const [key] of entries) assertKnownField(resource, key);

  const columns = entries.map(([key]) => quoteIdent(key)).join(", ");
  const placeholders = entries.map((_, i) => `$${i + 1}`).join(", ");
  const values = entries.map(([, value]) => value);
  const conflict = conflictFields.map((field) => quoteIdent(field)).join(", ");
  const updatable =
    updateFields?.length
      ? updateFields
      : entries.map(([key]) => key).filter((key) => !conflictFields.includes(key));

  for (const field of updatable) assertKnownField(resource, field);

  const setClause =
    updatable.length === 0
      ? `${quoteIdent(conflictFields[0]!)} = EXCLUDED.${quoteIdent(conflictFields[0]!)}`
      : updatable
          .map((field) => `${quoteIdent(field)} = EXCLUDED.${quoteIdent(field)}`)
          .join(", ");

  const text = `INSERT INTO ${qualifiedTable(resource)} (${columns}) VALUES (${placeholders}) ON CONFLICT (${conflict}) DO UPDATE SET ${setClause} RETURNING *`;
  return { text, values };
}

export function buildAggregateQuery(
  resource: ResourceMeta,
  options: {
    where?: Record<string, unknown>;
    aggregate: {
      count?: boolean;
      sum?: string[];
      avg?: string[];
      min?: string[];
      max?: string[];
      groupBy?: string[];
    };
  },
): BuiltQuery {
  const selectParts: string[] = [];
  if (options.aggregate.count) selectParts.push("COUNT(*)::int AS count");
  for (const field of options.aggregate.sum ?? []) {
    assertKnownField(resource, field);
    selectParts.push(`SUM(${quoteIdent(field)}) AS ${quoteIdent(`sum_${field}`)}`);
  }
  for (const field of options.aggregate.avg ?? []) {
    assertKnownField(resource, field);
    selectParts.push(`AVG(${quoteIdent(field)}) AS ${quoteIdent(`avg_${field}`)}`);
  }
  for (const field of options.aggregate.min ?? []) {
    assertKnownField(resource, field);
    selectParts.push(`MIN(${quoteIdent(field)}) AS ${quoteIdent(`min_${field}`)}`);
  }
  for (const field of options.aggregate.max ?? []) {
    assertKnownField(resource, field);
    selectParts.push(`MAX(${quoteIdent(field)}) AS ${quoteIdent(`max_${field}`)}`);
  }
  for (const field of options.aggregate.groupBy ?? []) {
    assertKnownField(resource, field);
    selectParts.push(quoteIdent(field));
  }
  if (selectParts.length === 0) {
    throw new RudraError("VALIDATION_ERROR", "Aggregate query requires at least one aggregation");
  }

  const where = buildWhere(resource, options.where);
  let text = `SELECT ${selectParts.join(", ")} FROM ${qualifiedTable(resource)}`;
  if (where.clause) text += ` WHERE ${where.clause}`;
  if (options.aggregate.groupBy?.length) {
    text += ` GROUP BY ${options.aggregate.groupBy.map((field) => quoteIdent(field)).join(", ")}`;
  }
  return { text, values: where.values };
}
