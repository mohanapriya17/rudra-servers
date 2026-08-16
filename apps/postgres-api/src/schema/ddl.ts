import { randomUUID } from "node:crypto";
import {
  assertPostgresFieldType,
  buildPostgresColumnType,
  quoteIdent,
} from "@rudra/metadata";
import {
  ensureSchema,
  assertSafePhysicalRef,
  type PostgresPool,
} from "@rudra/postgres-driver";
import { RudraError } from "@rudra/errors";
import type {
  PostgresFieldRecord,
  PostgresIndexRecord,
  PostgresRelationRecord,
  PostgresResourceRecord,
} from "../types.js";

function defaultSql(defaultValue: unknown): string | null {
  if (defaultValue == null) return null;
  if (defaultValue === "now") return "now()";
  if (defaultValue === "uuid") return "gen_random_uuid()";
  if (typeof defaultValue === "boolean") return defaultValue ? "true" : "false";
  if (typeof defaultValue === "number") return String(defaultValue);
  if (typeof defaultValue === "string") {
    // Reject raw SQL injection via defaults — only allow simple literals
    if (/^[a-zA-Z0-9_.:\-+ ]+$/.test(defaultValue)) {
      return `'${defaultValue.replace(/'/g, "''")}'`;
    }
    throw new RudraError("VALIDATION_ERROR", "Unsupported default value");
  }
  throw new RudraError("VALIDATION_ERROR", "Unsupported default value type");
}

export function columnDefinition(field: PostgresFieldRecord): string {
  assertPostgresFieldType(field.type);
  const typeSql = buildPostgresColumnType({
    type: field.type,
    length: field.length,
    precision: field.precision,
    scale: field.scale,
    array: field.array,
  });
  const parts = [quoteIdent(field.name), typeSql];
  if (field.primaryKey) parts.push("PRIMARY KEY");
  if (!field.nullable && !field.primaryKey) parts.push("NOT NULL");
  if (field.unique && !field.primaryKey) parts.push("UNIQUE");
  const def = defaultSql(field.defaultValue);
  if (def) parts.push(`DEFAULT ${def}`);
  if (field.check) {
    // Structured check expression limited to simple comparisons on the same column
    if (!/^[a-zA-Z0-9_ "'<>=!().,+-]+$/.test(field.check)) {
      throw new RudraError("VALIDATION_ERROR", "Invalid check constraint");
    }
    parts.push(`CHECK (${field.check})`);
  }
  return parts.join(" ");
}

export async function createPhysicalTable(
  pool: PostgresPool,
  resource: PostgresResourceRecord,
): Promise<void> {
  await pool.query(`CREATE EXTENSION IF NOT EXISTS pgcrypto`);
  await ensureSchema(pool, resource.physicalSchema);
  const { qualified } = assertSafePhysicalRef(resource.physicalSchema, resource.physicalTable);
  const columns = resource.fields.map((field) => columnDefinition(field)).join(",\n  ");
  await pool.query(`CREATE TABLE ${qualified} (\n  ${columns}\n)`);
}

export async function addPhysicalColumn(
  pool: PostgresPool,
  resource: PostgresResourceRecord,
  field: PostgresFieldRecord,
): Promise<void> {
  const { qualified } = assertSafePhysicalRef(resource.physicalSchema, resource.physicalTable);
  await pool.query(`ALTER TABLE ${qualified} ADD COLUMN ${columnDefinition(field)}`);
}

export async function dropPhysicalColumn(
  pool: PostgresPool,
  resource: PostgresResourceRecord,
  fieldName: string,
): Promise<void> {
  const { qualified } = assertSafePhysicalRef(resource.physicalSchema, resource.physicalTable);
  await pool.query(`ALTER TABLE ${qualified} DROP COLUMN ${quoteIdent(fieldName)}`);
}

export async function alterPhysicalColumnNullable(
  pool: PostgresPool,
  resource: PostgresResourceRecord,
  fieldName: string,
  nullable: boolean,
): Promise<void> {
  const { qualified } = assertSafePhysicalRef(resource.physicalSchema, resource.physicalTable);
  const action = nullable ? "DROP NOT NULL" : "SET NOT NULL";
  await pool.query(`ALTER TABLE ${qualified} ALTER COLUMN ${quoteIdent(fieldName)} ${action}`);
}

export async function createPhysicalIndex(
  pool: PostgresPool,
  resource: PostgresResourceRecord,
  index: PostgresIndexRecord,
): Promise<void> {
  const { qualified } = assertSafePhysicalRef(resource.physicalSchema, resource.physicalTable);
  const cols = index.fields.map((field) => quoteIdent(field)).join(", ");
  const unique = index.unique ? "UNIQUE " : "";
  const method = index.type;
  await pool.query(
    `CREATE ${unique}INDEX ${quoteIdent(index.name)} ON ${qualified} USING ${method} (${cols})`,
  );
}

function referentialAction(action: string): string {
  switch (action) {
    case "cascade":
      return "CASCADE";
    case "restrict":
      return "RESTRICT";
    case "set null":
      return "SET NULL";
    case "set default":
      return "SET DEFAULT";
    case "no action":
      return "NO ACTION";
    default:
      throw new RudraError("VALIDATION_ERROR", `Unsupported referential action: ${action}`);
  }
}

export async function createPhysicalRelation(
  pool: PostgresPool,
  resource: PostgresResourceRecord,
  referenced: PostgresResourceRecord,
  relation: PostgresRelationRecord,
): Promise<void> {
  const from = assertSafePhysicalRef(resource.physicalSchema, resource.physicalTable).qualified;
  const to = assertSafePhysicalRef(referenced.physicalSchema, referenced.physicalTable).qualified;
  const constraint = quoteIdent(`fk_${relation.id.replace(/-/g, "").slice(0, 16)}`);
  await pool.query(
    `ALTER TABLE ${from}
     ADD CONSTRAINT ${constraint}
     FOREIGN KEY (${quoteIdent(relation.field)})
     REFERENCES ${to} (${quoteIdent(relation.referencesField)})
     ON DELETE ${referentialAction(relation.onDelete)}
     ON UPDATE ${referentialAction(relation.onUpdate)}`,
  );
}

export function newFieldRecord(input: {
  name: string;
  type: string;
  nullable?: boolean;
  primaryKey?: boolean;
  unique?: boolean;
  default?: unknown;
  length?: number;
  precision?: number;
  scale?: number;
  array?: boolean;
  check?: string;
}): PostgresFieldRecord {
  return {
    id: randomUUID(),
    name: input.name,
    type: input.type,
    nullable: input.nullable ?? !input.primaryKey,
    primaryKey: input.primaryKey ?? false,
    unique: input.unique ?? false,
    defaultValue: input.default ?? null,
    length: input.length,
    precision: input.precision,
    scale: input.scale,
    array: input.array,
    check: input.check,
  };
}
