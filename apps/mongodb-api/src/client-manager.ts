import { createMongoClient, pingMongo } from "@rudra/mongodb-driver";
import type { Db, MongoClient } from "mongodb";
import type { MongoRegistry } from "./registry.js";

interface Cached {
  client: MongoClient;
  db: Db;
}

export class ClientManager {
  private clients = new Map<string, Cached>();

  constructor(private readonly registry: MongoRegistry) {}

  async getDb(source: string): Promise<Db> {
    const ds = this.registry.resolveDataSource(source);
    const existing = this.clients.get(ds.id);
    if (existing) return existing.db;

    const { client, db } = await createMongoClient({
      connectionString: ds.connectionString,
      dbName: ds.database,
    });
    await pingMongo(client);
    this.clients.set(ds.id, { client, db });
    return db;
  }

  async closeAll(): Promise<void> {
    await Promise.all([...this.clients.values()].map(({ client }) => client.close()));
    this.clients.clear();
  }
}
