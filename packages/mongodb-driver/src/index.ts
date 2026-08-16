import { MongoClient, type Db } from "mongodb";
import { RudraError } from "@rudra/errors";

export interface MongoConnectionOptions {
  connectionString: string;
  dbName?: string;
}

export async function createMongoClient(options: MongoConnectionOptions): Promise<{
  client: MongoClient;
  db: Db;
}> {
  const client = new MongoClient(options.connectionString);
  await client.connect();
  const db = client.db(options.dbName);
  return { client, db };
}

export async function pingMongo(client: MongoClient): Promise<boolean> {
  try {
    await client.db().command({ ping: 1 });
    return true;
  } catch (error) {
    throw new RudraError("SERVICE_UNAVAILABLE", "MongoDB unavailable", { cause: error });
  }
}

/** Only allow a curated set of aggregation stages. */
export const ALLOWED_AGGREGATION_STAGES = new Set([
  "match",
  "group",
  "sort",
  "limit",
  "skip",
  "project",
  "unwind",
  "lookup",
  "count",
]);

export function assertAllowedAggregationStage(stage: string): void {
  if (!ALLOWED_AGGREGATION_STAGES.has(stage)) {
    throw new RudraError("VALIDATION_ERROR", `Aggregation stage not allowed: ${stage}`);
  }
}
