import {
  createPostgresPool,
  pingPostgres,
  type PostgresPool,
} from "@rudra/postgres-driver";
import type { PostgresRegistry } from "./registry.js";

export class PoolManager {
  private pools = new Map<string, PostgresPool>();

  constructor(private readonly registry: PostgresRegistry) {}

  async getPool(source: string): Promise<PostgresPool> {
    const ds = this.registry.resolveDataSource(source);
    const existing = this.pools.get(ds.id);
    if (existing) return existing;
    const pool = createPostgresPool({
      connectionString: ds.connectionString,
      ssl: ds.ssl,
    });
    await pingPostgres(pool);
    this.pools.set(ds.id, pool);
    return pool;
  }

  async closeAll(): Promise<void> {
    await Promise.all([...this.pools.values()].map((pool) => pool.end()));
    this.pools.clear();
  }
}
