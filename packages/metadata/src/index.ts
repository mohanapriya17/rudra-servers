import { createHash, randomBytes } from "node:crypto";
import { RudraError } from "@rudra/errors";

const SLUG_RE = /^[a-z][a-z0-9_]*$/;
const IDENT_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

export function slugifyName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

export function assertResourceSlug(name: string): string {
  if (!SLUG_RE.test(name)) {
    throw new RudraError(
      "VALIDATION_ERROR",
      "Resource name must match /^[a-z][a-z0-9_]*$/",
    );
  }
  return name;
}

export function assertIdentifier(name: string, label = "identifier"): string {
  if (!IDENT_RE.test(name) || name.length > 63) {
    throw new RudraError("VALIDATION_ERROR", `Invalid ${label}: ${name}`);
  }
  return name;
}

/** Quote a validated PostgreSQL identifier. Never pass unvalidated input. */
export function quoteIdent(ident: string): string {
  const safe = assertIdentifier(ident);
  return `"${safe.replace(/"/g, '""')}"`;
}

export function physicalSchemaForApp(applicationId: string): string {
  const compact = applicationId.replace(/[^a-zA-Z0-9]/g, "").toLowerCase().slice(0, 12);
  return `rudra_app_${compact || "x"}`;
}

export function physicalTableName(resourceId?: string): string {
  const suffix = (resourceId ?? randomBytes(4).toString("hex")).replace(/[^a-zA-Z0-9]/g, "").slice(0, 12);
  return `resource_${suffix || createHash("sha1").update(randomBytes(8)).digest("hex").slice(0, 8)}`;
}

export type PostgresFieldType =
  | "text"
  | "varchar"
  | "char"
  | "smallint"
  | "integer"
  | "bigint"
  | "numeric"
  | "real"
  | "double precision"
  | "boolean"
  | "uuid"
  | "date"
  | "time"
  | "timetz"
  | "timestamp"
  | "timestamptz"
  | "interval"
  | "json"
  | "jsonb"
  | "bytea"
  | "inet"
  | "cidr"
  | "macaddr";

const PG_TYPES = new Set<string>([
  "text",
  "varchar",
  "char",
  "smallint",
  "integer",
  "bigint",
  "numeric",
  "real",
  "double precision",
  "boolean",
  "uuid",
  "date",
  "time",
  "timetz",
  "timestamp",
  "timestamptz",
  "interval",
  "json",
  "jsonb",
  "bytea",
  "inet",
  "cidr",
  "macaddr",
]);

export function assertPostgresFieldType(type: string): PostgresFieldType {
  if (!PG_TYPES.has(type)) {
    throw new RudraError("VALIDATION_ERROR", `Unsupported PostgreSQL field type: ${type}`);
  }
  return type as PostgresFieldType;
}

export function buildPostgresColumnType(options: {
  type: string;
  length?: number;
  precision?: number;
  scale?: number;
  array?: boolean;
}): string {
  const type = assertPostgresFieldType(options.type);
  let sql: string = type;
  if ((type === "varchar" || type === "char") && options.length) {
    sql = `${type}(${options.length})`;
  }
  if (type === "numeric" && options.precision) {
    sql = options.scale != null
      ? `numeric(${options.precision},${options.scale})`
      : `numeric(${options.precision})`;
  }
  if (options.array) sql = `${sql}[]`;
  return sql;
}

export const FILTER_OPERATORS = [
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
] as const;

export type FilterOperator = (typeof FILTER_OPERATORS)[number];

export function assertFilterOperator(op: string): FilterOperator {
  if (!(FILTER_OPERATORS as readonly string[]).includes(op)) {
    throw new RudraError("VALIDATION_ERROR", `Unsupported filter operator: ${op}`);
  }
  return op as FilterOperator;
}
