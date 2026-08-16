import pg from "pg";
import { RudraError } from "@rudra/errors";
import { quoteIdent } from "@rudra/metadata";

const { Pool } = pg;

export type PostgresPool = pg.Pool;
export type PostgresClient = pg.PoolClient;

export interface PostgresConnectionOptions {
  connectionString: string;
  ssl?: boolean | { rejectUnauthorized?: boolean };
  max?: number;
}

export function createPostgresPool(options: PostgresConnectionOptions): PostgresPool {
  return new Pool({
    connectionString: options.connectionString,
    ssl: options.ssl === true ? { rejectUnauthorized: false } : options.ssl ?? undefined,
    max: options.max ?? 10,
  });
}

export async function withTransaction<T>(
  pool: PostgresPool,
  fn: (client: PostgresClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // ignore rollback errors
    }
    throw error;
  } finally {
    client.release();
  }
}

export async function ensureSchema(
  client: { query: (text: string, values?: unknown[]) => Promise<unknown> },
  schema: string,
): Promise<void> {
  await client.query(`CREATE SCHEMA IF NOT EXISTS ${quoteIdent(schema)}`);
}

export function assertSafePhysicalRef(
  schema: string | null,
  table: string,
): {
  schema: string | null;
  table: string;
  qualified: string;
} {
  const safeTable = quoteIdent(table);
  if (!schema) {
    return { schema: null, table, qualified: safeTable };
  }
  const safeSchema = quoteIdent(schema);
  return {
    schema,
    table,
    qualified: `${safeSchema}.${safeTable}`,
  };
}

export async function pingPostgres(pool: PostgresPool): Promise<boolean> {
  try {
    await pool.query("SELECT 1");
    return true;
  } catch (error) {
    throw new RudraError("SERVICE_UNAVAILABLE", "PostgreSQL unavailable", { cause: error });
  }
}
