import {
  buildAggregateQuery,
  buildDeleteQuery,
  buildInsertQuery,
  buildSelectQuery,
  buildUpdateQuery,
  buildUpsertQuery,
  withTransaction,
  type PostgresClient,
  type PostgresPool,
  type ResourceMeta,
} from "@rudra/postgres-driver";
import { RudraError } from "@rudra/errors";
import type { PostgresResourceRecord } from "../types.js";

export function toResourceMeta(resource: PostgresResourceRecord): ResourceMeta {
  return {
    name: resource.name,
    physicalSchema: resource.physicalSchema,
    physicalTable: resource.physicalTable,
    fields: resource.fields.map((field) => ({
      name: field.name,
      type: field.type,
      primaryKey: field.primaryKey,
      nullable: field.nullable,
      unique: field.unique,
    })),
  };
}

type Executor = Pick<PostgresPool, "query"> | PostgresClient;

export async function listRows(
  exec: Executor,
  resource: PostgresResourceRecord,
  options: {
    where?: Record<string, unknown>;
    orderBy?: Array<{ field: string; direction: "asc" | "desc" }>;
    select?: string[];
    limit?: number;
    offset?: number;
  },
) {
  const query = buildSelectQuery(toResourceMeta(resource), options);
  const result = await exec.query(query.text, query.values);
  return result.rows;
}

export async function getRow(
  exec: Executor,
  resource: PostgresResourceRecord,
  id: string | number,
) {
  const pk = resource.fields.find((field) => field.primaryKey);
  if (!pk) throw new RudraError("VALIDATION_ERROR", "Missing primary key");
  const rows = await listRows(exec, resource, {
    where: { [pk.name]: { eq: id } },
    limit: 1,
  });
  const row = rows[0];
  if (!row) throw new RudraError("NOT_FOUND", "Record not found");
  return row;
}

export async function createRow(
  exec: Executor,
  resource: PostgresResourceRecord,
  data: Record<string, unknown>,
) {
  const query = buildInsertQuery(toResourceMeta(resource), data);
  const result = await exec.query(query.text, query.values);
  return result.rows[0];
}

export async function updateRow(
  exec: Executor,
  resource: PostgresResourceRecord,
  id: string | number,
  data: Record<string, unknown>,
) {
  const query = buildUpdateQuery(toResourceMeta(resource), id, data);
  const result = await exec.query(query.text, query.values);
  const row = result.rows[0];
  if (!row) throw new RudraError("NOT_FOUND", "Record not found");
  return row;
}

export async function deleteRow(
  exec: Executor,
  resource: PostgresResourceRecord,
  id: string | number,
) {
  const query = buildDeleteQuery(toResourceMeta(resource), id);
  const result = await exec.query(query.text, query.values);
  const row = result.rows[0];
  if (!row) throw new RudraError("NOT_FOUND", "Record not found");
  return row;
}

export async function upsertRow(
  exec: Executor,
  resource: PostgresResourceRecord,
  data: Record<string, unknown>,
  conflictFields: string[],
  updateFields?: string[],
) {
  const query = buildUpsertQuery(toResourceMeta(resource), data, conflictFields, updateFields);
  const result = await exec.query(query.text, query.values);
  return result.rows[0];
}

export async function queryRows(
  exec: Executor,
  resource: PostgresResourceRecord,
  body: {
    where?: Record<string, unknown>;
    and?: Array<Record<string, unknown>>;
    or?: Array<Record<string, unknown>>;
    orderBy?: Array<{ field: string; direction: "asc" | "desc" }>;
    select?: string[];
    limit?: number;
    offset?: number;
    aggregate?: {
      count?: boolean;
      sum?: string[];
      avg?: string[];
      min?: string[];
      max?: string[];
      groupBy?: string[];
    };
  },
) {
  const where: Record<string, unknown> = { ...(body.where ?? {}) };
  if (body.and) where.and = body.and;
  if (body.or) where.or = body.or;

  if (body.aggregate) {
    const query = buildAggregateQuery(toResourceMeta(resource), {
      where,
      aggregate: body.aggregate,
    });
    const result = await exec.query(query.text, query.values);
    return { data: result.rows, aggregate: true };
  }

  const rows = await listRows(exec, resource, {
    where,
    orderBy: body.orderBy,
    select: body.select,
    limit: body.limit ?? 50,
    offset: body.offset ?? 0,
  });
  return { data: rows, aggregate: false };
}

export async function bulkCreate(
  exec: Executor,
  resource: PostgresResourceRecord,
  records: Array<Record<string, unknown>>,
) {
  const created = [];
  for (const record of records) {
    created.push(await createRow(exec, resource, record));
  }
  return created;
}

export async function bulkUpdate(
  exec: Executor,
  resource: PostgresResourceRecord,
  records: Array<{ id: string | number; data: Record<string, unknown> }>,
) {
  const updated = [];
  for (const record of records) {
    updated.push(await updateRow(exec, resource, record.id, record.data));
  }
  return updated;
}

export async function bulkDelete(
  exec: Executor,
  resource: PostgresResourceRecord,
  ids: Array<string | number>,
) {
  const deleted = [];
  for (const id of ids) {
    deleted.push(await deleteRow(exec, resource, id));
  }
  return deleted;
}

export async function runTransaction(
  pool: PostgresPool,
  resolveResource: (name: string) => PostgresResourceRecord,
  operations: Array<Record<string, unknown>>,
) {
  return withTransaction(pool, async (client) => {
    const results = [];
    for (const op of operations) {
      const operation = String(op.operation);
      const resource = resolveResource(String(op.resource));
      if (operation === "create") {
        results.push({
          operation,
          data: await createRow(client, resource, op.data as Record<string, unknown>),
        });
      } else if (operation === "update") {
        results.push({
          operation,
          data: await updateRow(
            client,
            resource,
            op.id as string | number,
            op.data as Record<string, unknown>,
          ),
        });
      } else if (operation === "delete") {
        results.push({
          operation,
          data: await deleteRow(client, resource, op.id as string | number),
        });
      } else if (operation === "upsert") {
        results.push({
          operation,
          data: await upsertRow(
            client,
            resource,
            op.data as Record<string, unknown>,
            op.conflictFields as string[],
          ),
        });
      } else {
        throw new RudraError("UNSUPPORTED_OPERATION", `Unsupported operation: ${operation}`);
      }
    }
    return results;
  });
}
