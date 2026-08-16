import { loadControlPlaneEnv, loadServiceConfig } from "@rudra/config";
import { createApp } from "./app.js";
import { MemoryControlPlaneStore } from "./store/memory.js";

async function main(): Promise<void> {
  const config = loadServiceConfig("control-plane-api");
  const env = loadControlPlaneEnv();
  const store = new MemoryControlPlaneStore(env.secretsEncryptionKey);
  const { app, logger } = createApp({ store });

  if (!env.databaseUrl) {
    logger.warn("CONTROL_PLANE_DATABASE_URL not set; using in-memory control plane store");
  } else {
    logger.info("CONTROL_PLANE_DATABASE_URL configured; memory store active for Phase 1 bootstrap (Postgres adapter next)");
  }

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
