import {
  createPostgresPool,
  type PostgresPool,
} from "@rudra/postgres-driver";
import { RudraError } from "@rudra/errors";
import { decryptSecret, encryptSecret } from "../crypto/secrets.js";
import type { PostgresDataSourceRecord, PostgresResourceRecord } from "../types.js";
import type { PostgresRegistry } from "../registry.js";

const META_SCHEMA = "rudra_meta";

export interface RegistryStore {
  readonly mode: "memory" | "postgres";
  hydrate(registry: PostgresRegistry): Promise<void>;
  saveDataSource(ds: PostgresDataSourceRecord): Promise<void>;
  deleteDataSource(id: string): Promise<void>;
  saveResource(resource: PostgresResourceRecord): Promise<void>;
  deleteResource(id: string): Promise<void>;
  close(): Promise<void>;
}

export class MemoryRegistryStore implements RegistryStore {
  readonly mode = "memory" as const;

  async hydrate(_registry: PostgresRegistry): Promise<void> {}
  async saveDataSource(_ds: PostgresDataSourceRecord): Promise<void> {}
  async deleteDataSource(_id: string): Promise<void> {}
  async saveResource(_resource: PostgresResourceRecord): Promise<void> {}
  async deleteResource(_id: string): Promise<void> {}
  async close(): Promise<void> {}
}

export class PostgresRegistryStore implements RegistryStore {
  readonly mode = "postgres" as const;
  private pool: PostgresPool;
  private ready: Promise<void>;

  constructor(
    connectionString: string,
    private readonly encryptionKey: string,
  ) {
    this.pool = createPostgresPool({
      connectionString,
      ssl: /sslmode=require|neon\.tech|ssl=true/i.test(connectionString) ? true : undefined,
    });
    this.ready = this.migrate();
  }

  private async migrate(): Promise<void> {
    await this.pool.query(`CREATE SCHEMA IF NOT EXISTS ${META_SCHEMA}`);
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS ${META_SCHEMA}.datasources (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        ssl BOOLEAN NOT NULL DEFAULT false,
        application_id TEXT,
        environment_id TEXT,
        connection_secret_id TEXT,
        connection_ciphertext TEXT NOT NULL,
        connection_iv TEXT NOT NULL,
        connection_tag TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL
      )
    `);
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS ${META_SCHEMA}.resources (
        id TEXT PRIMARY KEY,
        data_source_id TEXT NOT NULL REFERENCES ${META_SCHEMA}.datasources(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        document JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL,
        UNIQUE (data_source_id, name)
      )
    `);
  }

  async hydrate(registry: PostgresRegistry): Promise<void> {
    await this.ready;
    const dsRes = await this.pool.query<{
      id: string;
      name: string;
      ssl: boolean;
      application_id: string | null;
      environment_id: string | null;
      connection_secret_id: string | null;
      connection_ciphertext: string;
      connection_iv: string;
      connection_tag: string;
      created_at: Date;
      updated_at: Date;
    }>(`SELECT * FROM ${META_SCHEMA}.datasources ORDER BY created_at ASC`);

    const dataSources: PostgresDataSourceRecord[] = dsRes.rows.map((row) => {
      let connectionString: string;
      try {
        connectionString = decryptSecret(
          {
            ciphertext: row.connection_ciphertext,
            iv: row.connection_iv,
            tag: row.connection_tag,
          },
          this.encryptionKey,
        );
      } catch (error) {
        throw new RudraError(
          "INTERNAL_ERROR",
          "Failed to decrypt persisted datasource connection string; check POSTGRES_METADATA_ENCRYPTION_KEY",
          { cause: error },
        );
      }
      return {
        id: row.id,
        name: row.name,
        ssl: row.ssl,
        applicationId: row.application_id ?? undefined,
        environmentId: row.environment_id ?? undefined,
        connectionSecretId: row.connection_secret_id ?? undefined,
        connectionString,
        createdAt: row.created_at.toISOString(),
        updatedAt: row.updated_at.toISOString(),
      };
    });

    const resourceRes = await this.pool.query<{ document: PostgresResourceRecord }>(
      `SELECT document FROM ${META_SCHEMA}.resources ORDER BY created_at ASC`,
    );
    const resources = resourceRes.rows.map((row) => row.document);
    registry.loadSnapshot(dataSources, resources);
  }

  async saveDataSource(ds: PostgresDataSourceRecord): Promise<void> {
    await this.ready;
    const encrypted = encryptSecret(ds.connectionString, this.encryptionKey);
    await this.pool.query(
      `
      INSERT INTO ${META_SCHEMA}.datasources (
        id, name, ssl, application_id, environment_id, connection_secret_id,
        connection_ciphertext, connection_iv, connection_tag, created_at, updated_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
      ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name,
        ssl = EXCLUDED.ssl,
        application_id = EXCLUDED.application_id,
        environment_id = EXCLUDED.environment_id,
        connection_secret_id = EXCLUDED.connection_secret_id,
        connection_ciphertext = EXCLUDED.connection_ciphertext,
        connection_iv = EXCLUDED.connection_iv,
        connection_tag = EXCLUDED.connection_tag,
        updated_at = EXCLUDED.updated_at
      `,
      [
        ds.id,
        ds.name,
        ds.ssl,
        ds.applicationId ?? null,
        ds.environmentId ?? null,
        ds.connectionSecretId ?? null,
        encrypted.ciphertext,
        encrypted.iv,
        encrypted.tag,
        ds.createdAt,
        ds.updatedAt,
      ],
    );
  }

  async deleteDataSource(id: string): Promise<void> {
    await this.ready;
    await this.pool.query(`DELETE FROM ${META_SCHEMA}.datasources WHERE id = $1`, [id]);
  }

  async saveResource(resource: PostgresResourceRecord): Promise<void> {
    await this.ready;
    await this.pool.query(
      `
      INSERT INTO ${META_SCHEMA}.resources (
        id, data_source_id, name, document, created_at, updated_at
      ) VALUES ($1,$2,$3,$4::jsonb,$5,$6)
      ON CONFLICT (id) DO UPDATE SET
        data_source_id = EXCLUDED.data_source_id,
        name = EXCLUDED.name,
        document = EXCLUDED.document,
        updated_at = EXCLUDED.updated_at
      `,
      [
        resource.id,
        resource.dataSourceId,
        resource.name,
        JSON.stringify(resource),
        resource.createdAt,
        resource.updatedAt,
      ],
    );
  }

  async deleteResource(id: string): Promise<void> {
    await this.ready;
    await this.pool.query(`DELETE FROM ${META_SCHEMA}.resources WHERE id = $1`, [id]);
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

export function createRegistryStoreFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): RegistryStore {
  const metadataUrl = env.POSTGRES_METADATA_URL?.trim();
  if (!metadataUrl) {
    return new MemoryRegistryStore();
  }
  const encryptionKey =
    env.POSTGRES_METADATA_ENCRYPTION_KEY?.trim() ||
    env.SECRETS_ENCRYPTION_KEY?.trim() ||
    "";
  if (encryptionKey.length < 16) {
    throw new Error(
      "POSTGRES_METADATA_URL is set but POSTGRES_METADATA_ENCRYPTION_KEY (or SECRETS_ENCRYPTION_KEY) must be at least 16 characters",
    );
  }
  return new PostgresRegistryStore(metadataUrl, encryptionKey);
}
