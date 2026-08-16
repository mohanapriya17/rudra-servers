import { loadServiceConfig } from "@rudra/config";
import { createApp } from "./app.js";

async function main(): Promise<void> {
  const config = loadServiceConfig("graphql-api");
  const postgresEndpoints = new Map<string, string>();
  const mongoEndpoints = new Map<string, string>();

  // Optional wiring: GRAPHQL_PG_<id>=http://postgres-api:4001/api/v1/postgres/<source>
  for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith("GRAPHQL_PG_") && value) {
      postgresEndpoints.set(key.slice("GRAPHQL_PG_".length), value);
    }
    if (key.startsWith("GRAPHQL_MONGO_") && value) {
      mongoEndpoints.set(key.slice("GRAPHQL_MONGO_".length), value);
    }
  }

  const allowedRestHosts = new Set(
    (process.env.GRAPHQL_REST_ALLOWLIST ?? "*").split(",").map((item) => item.trim()).filter(Boolean),
  );

  const { app, logger } = createApp({
    contextDefaults: {
      postgresEndpoints,
      mongoEndpoints,
      functionEndpoint: process.env.FUNCTION_API_URL,
      allowedRestHosts,
      fetchImpl: fetch,
    },
  });

  const { createServer } = await import("node:http");
  const server = createServer(app);
  await new Promise<void>((resolve, reject) => {
    server.listen(config.port, config.host, () => resolve());
    server.once("error", reject);
  });
  logger.info("listening", { host: config.host, port: config.port });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
